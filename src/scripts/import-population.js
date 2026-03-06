/**
 * import-population.js
 *
 * Parse les CSV ANSD (data/ansd-csv/) et peuple localites.population.
 *
 * Format réel ANSD 2023 :
 *   Region, Departement, COM_ARRT_VILLE, COMMUNE,
 *   QUARTIER_VILLAGE_HAMEAU, CONCESSION, MENAGE,
 *   HOMMES, FEMMES, POPULATION
 *
 * Stratégie :
 *  1. Agréger POPULATION par QUARTIER_VILLAGE_HAMEAU dans chaque CSV
 *  2. Correspondance par nom normalisé contre localites.name
 *     (exact, puis ILIKE, puis trigram si pg_trgm dispo)
 *
 * Usage : node src/scripts/import-population.js
 */

const fs   = require('fs');
const path = require('path');
const pool = require('../database/connection');

const CSV_DIR = path.resolve(__dirname, '../../data/ansd-csv');

// ─── Colonnes attendues dans le CSV ANSD ─────────────────────────
const COL_LOCALITY = 'quartier_village_hameau';  // index 4
const COL_POP      = 'population';               // index 9

// ─── Normalisation ───────────────────────────────────────────────

function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[""«»]/g, '')
    .replace(/[-'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── Parseur CSV (gère les guillemets ANSD) ───────────────────────

function parseCsvLine(line, sep = ',') {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur.trim());
  return fields;
}

/**
 * Parse un CSV ANSD et retourne une Map nom_normalisé → population_agrégée
 * Les noms peuvent apparaître plusieurs fois (concessions/ménages multiples).
 */
function parseCsvToMap(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return new Map();

  // Détecter le séparateur
  const sepCounts = { ',': 0, ';': 0, '\t': 0 };
  for (const c of lines[0]) if (sepCounts[c] !== undefined) sepCounts[c]++;
  const sep = Object.entries(sepCounts).sort((a, b) => b[1] - a[1])[0][0];

  const headers = parseCsvLine(lines[0], sep)
    .map(h => h.toLowerCase().replace(/['"]/g, '').trim());

  // Trouver les index
  const idxLocality = headers.findIndex(h =>
    h === COL_LOCALITY || /quartier|village|hameau|localit/i.test(h)
  );
  const idxPop = headers.findIndex(h =>
    h === COL_POP || /^population$|^total$/i.test(h)
  );
  const idxCommune = headers.findIndex(h => /^commune$/i.test(h));

  if (idxLocality === -1 || idxPop === -1) {
    return { map: new Map(), headers, idxLocality, idxPop };
  }

  // Agréger : clé composite (commune_normalisée|localite_normalisée) → { pop, rawName, commune }
  // Cela évite que deux localités de même nom dans des communes différentes
  // se retrouvent fusionnées en une seule entrée.
  const aggr = new Map();

  for (let i = 1; i < lines.length; i++) {
    const fields  = parseCsvLine(lines[i], sep);
    const rawName = fields[idxLocality]?.replace(/^["']|["']$/g, '').trim();
    const popRaw  = fields[idxPop]?.replace(/[^0-9]/g, '');
    const pop     = parseInt(popRaw, 10);
    const commune = idxCommune >= 0
      ? fields[idxCommune]?.replace(/^["']|["']$/g, '').trim()
      : null;

    if (!rawName || isNaN(pop) || pop <= 0) continue;

    const normLoc  = normalizeName(rawName);
    const normComm = normalizeName(commune || '');
    const key      = normComm + '|' + normLoc;

    if (aggr.has(key)) {
      aggr.get(key).pop += pop;
    } else {
      aggr.set(key, { name: rawName, pop, commune, normLoc });
    }
  }

  return { map: aggr, headers, idxLocality, idxPop };
}

// ─── Correspondance DB ────────────────────────────────────────────

// Cache commune_name (CSV) → commune_id (DB)
const communeIdCache = new Map();

async function getCommuneId(client, csvCommuneName) {
  if (!csvCommuneName) return null;
  const normKey = normalizeName(csvCommuneName);
  if (communeIdCache.has(normKey)) return communeIdCache.get(normKey);

  const { rows } = await client.query(
    'SELECT id FROM communes WHERE lower(name) = $1 OR lower(name) = lower($2) LIMIT 1',
    [normKey, csvCommuneName]
  );
  const id = rows.length > 0 ? rows[0].id : null;
  communeIdCache.set(normKey, id);
  return id;
}

async function matchAndUpdate(client, normLocKey, rawName, pop, csvCommune, stats) {
  const communeId = await getCommuneId(client, csvCommune);

  // 1a. Exact par nom + commune_id (prioritaire si commune connue)
  if (communeId) {
    const { rows } = await client.query(
      'SELECT id FROM localites WHERE lower(name) = $1 AND commune_id = $2 LIMIT 1',
      [normLocKey, communeId]
    );
    if (rows.length > 0) {
      await client.query(
        'UPDATE localites SET population = COALESCE(population, 0) + $1 WHERE id = $2',
        [pop, rows[0].id]
      );
      stats.matched++;
      return;
    }

    // 1b. ILIKE + commune_id
    const { rows: r1b } = await client.query(
      'SELECT id FROM localites WHERE name ILIKE $1 AND commune_id = $2 LIMIT 1',
      ['%' + rawName + '%', communeId]
    );
    if (r1b.length > 0) {
      await client.query(
        'UPDATE localites SET population = COALESCE(population, 0) + $1 WHERE id = $2',
        [pop, r1b[0].id]
      );
      stats.matched++;
      return;
    }
  }

  // 2. Fallback : exact par nom seul (toutes communes)
  const { rows: r2 } = await client.query(
    'SELECT id FROM localites WHERE lower(name) = $1 LIMIT 1',
    [normLocKey]
  );
  if (r2.length > 0) {
    await client.query(
      'UPDATE localites SET population = COALESCE(population, 0) + $1 WHERE id = $2',
      [pop, r2[0].id]
    );
    stats.matched++;
    return;
  }

  // 3. Fallback ILIKE seul
  const { rows: r3 } = await client.query(
    'SELECT id FROM localites WHERE name ILIKE $1 LIMIT 1',
    ['%' + rawName + '%']
  );
  if (r3.length > 0) {
    await client.query(
      'UPDATE localites SET population = COALESCE(population, 0) + $1 WHERE id = $2',
      [pop, r3[0].id]
    );
    stats.matched++;
    return;
  }

  stats.unmatched++;
  if (stats.unmatched <= 3) {
    console.log('      \u21b3 Non trouvé : "' + rawName + '" (commune CSV: ' + (csvCommune||'?') + ')');
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║        import-population.js                      ║');
  console.log('║  Format ANSD 2023 — QUARTIER_VILLAGE_HAMEAU      ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  if (!fs.existsSync(CSV_DIR)) {
    console.error(`\n❌ Dossier CSV introuvable : ${CSV_DIR}`);
    process.exit(1);
  }

  const csvFiles = fs.readdirSync(CSV_DIR)
    .filter(f => f.endsWith('.csv'))
    .sort();

  if (csvFiles.length === 0) {
    console.error('\n❌ Aucun fichier CSV dans ' + CSV_DIR);
    process.exit(1);
  }

  console.log(`\n  ${csvFiles.length} CSV dans ${CSV_DIR}\n`);

  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE localites ADD COLUMN IF NOT EXISTS population INTEGER
    `);

    // Remettre à zéro pour réimport propre
    await client.query('UPDATE localites SET population = NULL');

    let totalEntries = 0;
    let globalStats = { matched: 0, unmatched: 0 };

    for (const file of csvFiles) {
      const content = fs.readFileSync(path.join(CSV_DIR, file), 'utf8');
      const { map, headers, idxLocality, idxPop } = parseCsvToMap(content);

      if (!map || map.size === 0) {
        console.log(`  ⚠ ${file} : aucune ligne (idxLoc=${idxLocality} idxPop=${idxPop})`);
        if (headers) console.log(`    → ${headers.join(' | ')}`);
        continue;
      }

      console.log(`  📄 ${file.padEnd(30)} ${map.size} localités agrégées`);
      totalEntries += map.size;

      const fileStats = { matched: 0, unmatched: 0 };
      await client.query('BEGIN');

      for (const [, { name, pop, commune, normLoc }] of map) {
        await matchAndUpdate(client, normLoc, name, pop, commune, fileStats);
      }

      await client.query('COMMIT');
      console.log(`     ✓ ${fileStats.matched} matchées, ${fileStats.unmatched} non trouvées`);
      globalStats.matched   += fileStats.matched;
      globalStats.unmatched += fileStats.unmatched;
    }

    // ─── Rapport final ─────────────────────────────────────────
    const { rows: [stats] } = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(population) AS with_pop,
        SUM(population) AS total_pop,
        MIN(population) AS min_pop,
        MAX(population) AS max_pop,
        ROUND(AVG(population)::numeric, 1) AS avg_pop
      FROM localites
    `);

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║           RAPPORT import-population             ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  CSV traités                  : ${String(csvFiles.length).padStart(10)} ║`);
    console.log(`║  Localités CSV agrégées       : ${String(totalEntries).padStart(10)} ║`);
    console.log(`║  Correspondances réussies     : ${String(globalStats.matched).padStart(10)} ║`);
    console.log(`║  Non trouvées                 : ${String(globalStats.unmatched).padStart(10)} ║`);
    console.log(`║  Localités DB avec population : ${String(stats.with_pop).padStart(10)} ║`);
    console.log(`║  Population totale            : ${String(stats.total_pop ?? 0).padStart(10)} ║`);
    console.log(`║  Pop min / max / moy          : ${String((stats.min_pop??0)+' / '+(stats.max_pop??0)+' / '+(stats.avg_pop??0)).padStart(10)} ║`);
    console.log('╚══════════════════════════════════════════════════╝');

    console.log('\n✅ Import terminé.');
    console.log('   Prochaine étape : node src/scripts/compute-densite.js');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Erreur :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
