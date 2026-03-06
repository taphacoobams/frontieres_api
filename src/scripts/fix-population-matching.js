/**
 * fix-population-matching.js
 *
 * Réconciliation robuste des 846 localités sans population.
 * Trois niveaux de matching :
 *   1. Exact normalisé  (nom normalisé + commune_id)
 *   2. Fuzzy pg_trgm    (similarity > 0.6 + commune_id)
 *   3. Fallback commune (meilleure similarité dans la même commune)
 *
 * Usage : node src/scripts/fix-population-matching.js
 *         npm run fix-population
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const pool = require('../database/connection');

const CSV_DIR     = path.resolve(__dirname, '../../data/ansd-csv');
const MISSING_OUT = path.resolve(__dirname, '../../data/missing_localites.csv');

// ─── Seuils de similarité ────────────────────────────────────────
const TRGM_THRESHOLD_COMMUNE = 0.6;   // fuzzy avec commune connue
const TRGM_THRESHOLD_FALLBACK = 0.5;  // fallback commune seule

// ─── Normalisation ───────────────────────────────────────────────

function normalizeName(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // accents
    .replace(/[''`'']/g, '')                            // apostrophes
    .replace(/-/g, ' ')                                 // tirets → espace
    .replace(/[^\w\s]/g, '')                            // ponctuation restante
    .replace(/\s+/g, ' ')                               // espaces multiples
    .trim();
}

// ─── Parseur CSV ─────────────────────────────────────────────────

function parseCsvLine(line, sep = ',') {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) {
      fields.push(cur.trim()); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur.trim());
  return fields;
}

/**
 * Charge tous les CSV ANSD et retourne un index :
 *   Map< normCommune|normLocalite , { rawName, pop, commune } >
 * Clé secondaire (sans commune) pour fallback :
 *   Map< normLocalite , [ { rawName, pop, commune, normComm } ] >
 */
function loadCsvIndex() {
  const byCommLoc = new Map();   // clé composite
  const byLocOnly = new Map();   // clé nom seul → tableau

  const csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));

  for (const file of csvFiles) {
    const content = fs.readFileSync(path.join(CSV_DIR, file), 'utf8');
    const lines   = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) continue;

    // Détecter séparateur
    const sepCounts = { ',': 0, ';': 0, '\t': 0 };
    for (const c of lines[0]) if (sepCounts[c] !== undefined) sepCounts[c]++;
    const sep = Object.entries(sepCounts).sort((a, b) => b[1] - a[1])[0][0];

    const headers = parseCsvLine(lines[0], sep)
      .map(h => h.toLowerCase().replace(/["]/g, '').trim());

    const idxLoc  = headers.findIndex(h => /quartier|village|hameau|localit/i.test(h));
    const idxPop  = headers.findIndex(h => /^population$/i.test(h));
    const idxComm = headers.findIndex(h => /^commune$/i.test(h));

    if (idxLoc === -1 || idxPop === -1) continue;

    for (let i = 1; i < lines.length; i++) {
      const fields  = parseCsvLine(lines[i], sep);
      const rawLoc  = (fields[idxLoc]  || '').replace(/^["']|["']$/g, '').trim();
      const rawComm = idxComm >= 0
        ? (fields[idxComm] || '').replace(/^["']|["']$/g, '').trim()
        : '';
      const pop = parseInt((fields[idxPop] || '').replace(/[^0-9]/g, ''), 10);

      if (!rawLoc || isNaN(pop) || pop <= 0) continue;

      const normLoc  = normalizeName(rawLoc);
      const normComm = normalizeName(rawComm);
      const key      = normComm + '|' + normLoc;

      // Index composite
      if (byCommLoc.has(key)) {
        byCommLoc.get(key).pop += pop;
      } else {
        byCommLoc.set(key, { rawName: rawLoc, pop, commune: rawComm, normComm, normLoc });
      }

      // Index nom seul
      if (!byLocOnly.has(normLoc)) byLocOnly.set(normLoc, []);
      const arr = byLocOnly.get(normLoc);
      const ex  = arr.find(e => e.normComm === normComm);
      if (ex) ex.pop += pop;
      else arr.push({ rawName: rawLoc, pop, commune: rawComm, normComm });
    }
  }

  return { byCommLoc, byLocOnly };
}

// ─── Cache commune_name → commune_id ─────────────────────────────

const communeIdCache = new Map();

async function getCommuneId(client, normCommName) {
  if (!normCommName) return null;
  if (communeIdCache.has(normCommName)) return communeIdCache.get(normCommName);

  const { rows } = await client.query(
    'SELECT id FROM communes WHERE lower(name) = $1 LIMIT 1',
    [normCommName]
  );
  let id = rows.length > 0 ? rows[0].id : null;
  if (!id) {
    // Essai avec normalisation JS du nom de commune
    const stripped = normCommName.replace(/[^a-z0-9 ]/g, '').trim();
    const { rows: r2 } = await client.query(
      'SELECT id FROM communes WHERE lower(name) = $1 LIMIT 1',
      [stripped]
    );
    id = r2.length > 0 ? r2[0].id : null;
  }
  communeIdCache.set(normCommName, id);
  return id;
}

// ─── Matching ────────────────────────────────────────────────────

/**
 * Niveau 1 : exact normalisé côté JS contre normalized_name en DB
 */
async function matchExact(client, normLoc, communeId) {
  if (!communeId) {
    const { rows } = await client.query(
      'SELECT id FROM localites WHERE normalized_name = $1 AND population IS NULL LIMIT 1',
      [normLoc]
    );
    return rows.length > 0 ? rows[0].id : null;
  }
  const { rows } = await client.query(
    'SELECT id FROM localites WHERE normalized_name = $1 AND commune_id = $2 AND population IS NULL LIMIT 1',
    [normLoc, communeId]
  );
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Niveau 2 : fuzzy pg_trgm sur normalized_name
 */
async function matchFuzzy(client, normLoc, communeId, threshold) {
  if (!communeId) {
    const { rows } = await client.query(
      'SELECT id, similarity(normalized_name, $1) AS sim FROM localites' +
      ' WHERE similarity(normalized_name, $1) > $2 AND population IS NULL' +
      ' ORDER BY sim DESC LIMIT 1',
      [normLoc, threshold]
    );
    return rows.length > 0 ? rows[0].id : null;
  }
  const { rows } = await client.query(
    'SELECT id, similarity(normalized_name, $1) AS sim FROM localites' +
    ' WHERE similarity(normalized_name, $1) > $2 AND commune_id = $3 AND population IS NULL' +
    ' ORDER BY sim DESC LIMIT 1',
    [normLoc, threshold, communeId]
  );
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Niveau 3 : fallback — meilleure similarité dans la même commune (seuil bas)
 */
async function matchFallback(client, normLoc, communeId) {
  if (!communeId) return null;
  const { rows } = await client.query(
    'SELECT id, similarity(normalized_name, $1) AS sim FROM localites' +
    ' WHERE commune_id = $2 AND population IS NULL' +
    ' ORDER BY sim DESC LIMIT 1',
    [normLoc, communeId]
  );
  if (rows.length > 0 && parseFloat(rows[0].sim) >= TRGM_THRESHOLD_FALLBACK) {
    return rows[0].id;
  }
  return null;
}

async function updatePop(client, id, pop) {
  await client.query(
    'UPDATE localites SET population = COALESCE(population, 0) + $1 WHERE id = $2',
    [pop, id]
  );
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║     fix-population-matching.js                   ║');
  console.log('║  Réconciliation robuste — 3 niveaux              ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const client = await pool.connect();

  // ── 0. Activer pg_trgm + colonne normalized_name ──────────────
  console.log('=== 0. Préparation DB ===');
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  // Ajouter colonne normalized_name si absente
  const { rows: colCheck } = await client.query(
    "SELECT 1 FROM information_schema.columns" +
    " WHERE table_name='localites' AND column_name='normalized_name'"
  );
  if (colCheck.length === 0) {
    await client.query('ALTER TABLE localites ADD COLUMN normalized_name text');
  }
  // Remplir normalized_name pour toutes les localités
  // On passe les chaînes translate comme paramètres pour éviter tout problème d'échappement
  await client.query(
    'UPDATE localites SET normalized_name =' +
    '  trim(regexp_replace(' +
    '    regexp_replace(' +
    '      lower(translate(name, $1, $2)),' +
    "    '[^a-z0-9 ]', '', 'g')," +
    "  ' +', ' ', 'g'))",
    [
      'àáâãäçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ-\'\`',
      'aaaaaaaceeeeiiiinooooouuuuyyAAAAAAAACEEEEIIIINOOOOOUUUUY  '
    ]
  );
  // Index GIN pour pg_trgm
  await client.query(
    'CREATE INDEX IF NOT EXISTS idx_localites_trgm ON localites USING GIN (normalized_name gin_trgm_ops)'
  );
  console.log('  ✓ pg_trgm activé, normalized_name calculé, index GIN créé\n');

  // ── 1. Charger les localités sans population ──────────────────
  const { rows: unmatched } = await client.query(`
    SELECT l.id, l.name, l.normalized_name, l.commune_id,
           c.name AS commune_name
    FROM localites l
    LEFT JOIN communes c ON c.id = l.commune_id
    WHERE l.population IS NULL
    ORDER BY l.id
  `);
  console.log(`=== Localités sans population : ${unmatched.length} ===\n`);

  if (unmatched.length === 0) {
    console.log('✅ Toutes les localités ont déjà une population.');
    client.release();
    await pool.end();
    return;
  }

  // ── 2. Charger l'index CSV ────────────────────────────────────
  console.log('=== 2. Chargement index CSV ===');
  const { byCommLoc, byLocOnly } = loadCsvIndex();
  console.log(`  → ${byCommLoc.size} entrées (commune|localite)`);
  console.log(`  → ${byLocOnly.size} entrées (localite seule)\n`);

  // ── 3. Matching ───────────────────────────────────────────────
  console.log('=== 3. Matching ===');

  const stats = { exact: 0, fuzzy: 0, fallback: 0, missed: 0 };
  const missingRows = [];

  await client.query('BEGIN');

  for (const loc of unmatched) {
    const normLoc  = loc.normalized_name || normalizeName(loc.name);
    const commName = loc.commune_name ? normalizeName(loc.commune_name) : null;
    const communeId = loc.commune_id;

    // ── Niveau 1 : exact normalisé (CSV index) ─────────────────
    // Cherche dans le CSV par clé composite
    let matched = false;

    if (commName) {
      const csvKey = commName + '|' + normLoc;
      if (byCommLoc.has(csvKey)) {
        const entry = byCommLoc.get(csvKey);
        // Vérifier exact en DB
        const dbId = await matchExact(client, normLoc, communeId);
        if (dbId) {
          await updatePop(client, dbId, entry.pop);
          stats.exact++;
          matched = true;
        }
      }
    }

    if (!matched) {
      // Essai exact sans commune (nom seul dans CSV)
      if (byLocOnly.has(normLoc)) {
        const dbId = await matchExact(client, normLoc, communeId) ||
                     await matchExact(client, normLoc, null);
        if (dbId) {
          // Choisir la pop de la bonne commune si possible
          const entries = byLocOnly.get(normLoc);
          const entry   = commName
            ? (entries.find(e => e.normComm === commName) || entries[0])
            : entries[0];
          await updatePop(client, dbId, entry.pop);
          stats.exact++;
          matched = true;
        }
      }
    }

    // ── Niveau 2 : fuzzy pg_trgm ────────────────────────────────
    if (!matched) {
      const dbId = await matchFuzzy(client, normLoc, communeId, TRGM_THRESHOLD_COMMUNE);
      if (dbId) {
        // Chercher la pop dans le CSV (meilleure entrée disponible)
        const entries = byLocOnly.get(normLoc);
        let pop = 0;
        if (entries && entries.length > 0) {
          const entry = commName
            ? (entries.find(e => e.normComm === commName) || entries[0])
            : entries[0];
          pop = entry.pop;
        } else {
          // Cherche fuzzy dans le CSV aussi
          let bestKey = null, bestSim = 0;
          for (const [k, v] of byCommLoc) {
            const csvNormLoc = k.split('|')[1];
            const sim = jsSimilarity(normLoc, csvNormLoc);
            if (sim > bestSim && (!commName || k.startsWith(commName))) {
              bestSim = sim; bestKey = k;
            }
          }
          if (bestKey && bestSim >= TRGM_THRESHOLD_COMMUNE) {
            pop = byCommLoc.get(bestKey).pop;
          }
        }
        if (pop > 0) {
          await updatePop(client, dbId, pop);
          stats.fuzzy++;
          matched = true;
        }
      }
    }

    // ── Niveau 3 : fallback commune ─────────────────────────────
    if (!matched) {
      // Trouver la meilleure entrée CSV dans la même commune
      let bestCsvPop = 0;
      let bestSim = 0;
      if (commName) {
        for (const [k, v] of byCommLoc) {
          const [kComm, kLoc] = k.split('|');
          if (kComm === commName) {
            const sim = jsSimilarity(normLoc, kLoc);
            if (sim > bestSim) { bestSim = sim; bestCsvPop = v.pop; }
          }
        }
      }
      if (bestSim >= TRGM_THRESHOLD_FALLBACK && bestCsvPop > 0) {
        const dbId = await matchFallback(client, normLoc, communeId);
        if (dbId) {
          await updatePop(client, dbId, bestCsvPop);
          stats.fallback++;
          matched = true;
        }
      }
    }

    if (!matched) {
      stats.missed++;
      missingRows.push(loc);
    }
  }

  await client.query('COMMIT');

  // ── 4. Recalculer population agrégée ─────────────────────────
  console.log('\n=== 4. Recalcul population agrégée ===');
  await client.query(`
    UPDATE communes c
    SET population = (
      SELECT SUM(l.population) FROM localites l
      WHERE l.commune_id = c.id AND l.population IS NOT NULL
    )
  `);
  await client.query(`
    UPDATE departements d
    SET population = (
      SELECT SUM(l.population) FROM localites l
      WHERE l.departement_id = d.id AND l.population IS NOT NULL
    )
  `);
  await client.query(`
    UPDATE regions r
    SET population = (
      SELECT SUM(l.population) FROM localites l
      WHERE l.region_id = r.id AND l.population IS NOT NULL
    )
  `);
  await client.query(`
    UPDATE communes SET densite = ROUND((population::numeric / NULLIF(superficie_km2,0))::numeric,2)
    WHERE population IS NOT NULL
  `);
  await client.query(`
    UPDATE departements SET densite = ROUND((population::numeric / NULLIF(superficie_km2,0))::numeric,2)
    WHERE population IS NOT NULL
  `);
  await client.query(`
    UPDATE regions SET densite = ROUND((population::numeric / NULLIF(superficie_km2,0))::numeric,2)
    WHERE population IS NOT NULL
  `);
  console.log('  ✓ Populations et densités recalculées\n');

  // ── 5. Export CSV des localités restantes ─────────────────────
  let missingCount = 0;
  if (missingRows.length > 0) {
    const { rows: stillMissing } = await client.query(`
      SELECT l.id, l.name, c.name AS commune, d.name AS departement, r.name AS region
      FROM localites l
      LEFT JOIN communes c     ON c.id = l.commune_id
      LEFT JOIN departements d ON d.id = l.departement_id
      LEFT JOIN regions r      ON r.id = l.region_id
      WHERE l.population IS NULL
      ORDER BY r.name, d.name, c.name, l.name
    `);
    missingCount = stillMissing.length;

    const csvLines = ['id,localite,commune,departement,region'];
    for (const row of stillMissing) {
      csvLines.push([
        row.id,
        `"${(row.name||'').replace(/"/g,'""')}"`,
        `"${(row.commune||'').replace(/"/g,'""')}"`,
        `"${(row.departement||'').replace(/"/g,'""')}"`,
        `"${(row.region||'').replace(/"/g,'""')}"`,
      ].join(','));
    }
    fs.mkdirSync(path.dirname(MISSING_OUT), { recursive: true });
    fs.writeFileSync(MISSING_OUT, csvLines.join('\n'), 'utf8');
    console.log(`  📄 Export : ${MISSING_OUT} (${missingCount} entrées)`);
  }

  // ── Rapport final ─────────────────────────────────────────────
  const { rows: [totals] } = await client.query(`
    SELECT COUNT(*) AS total, COUNT(population) AS with_pop,
           SUM(population) AS total_pop
    FROM localites
  `);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║          RAPPORT fix-population-matching        ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Total localités DB          : ${String(totals.total).padStart(8)} ║`);
  console.log(`║  Match exact (niveau 1)      : ${String(stats.exact).padStart(8)} ║`);
  console.log(`║  Match fuzzy trgm (niveau 2) : ${String(stats.fuzzy).padStart(8)} ║`);
  console.log(`║  Match fallback (niveau 3)   : ${String(stats.fallback).padStart(8)} ║`);
  console.log(`║  Restantes sans population   : ${String(missingCount).padStart(8)} ║`);
  console.log(`║  ────────────────────────────────────────── ║`);
  console.log(`║  Localités avec population   : ${String(totals.with_pop).padStart(8)} ║`);
  console.log(`║  Population totale           : ${String(Number(totals.total_pop||0).toLocaleString('fr')).padStart(12)} ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (missingCount > 0) {
    console.log(`⚠  ${missingCount} localités restantes → voir ${MISSING_OUT}`);
  } else {
    console.log('✅ Toutes les localités ont une population.');
  }

  client.release();
  await pool.end();
}

// ─── Similarité Jaccard sur bigrammes (fallback JS) ──────────────

function jsSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = s => {
    const bg = new Set();
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
    return bg;
  };
  const ba = bigrams(a), bb = bigrams(b);
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  return (2 * inter) / (ba.size + bb.size);
}

main().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
