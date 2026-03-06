/**
 * import-population.js
 *
 * Parse les CSV ANSD téléchargés dans data/ansd-csv/
 * et peuple la colonne population de la table localites.
 *
 * Format CSV ANSD attendu (colonnes variables, détection automatique) :
 *   Localite | Village | Nom | Population | Effectif | Total | ...
 *
 * Usage : node src/scripts/import-population.js
 */

const fs   = require('fs');
const path = require('path');
const pool = require('../database/connection');

const CSV_DIR = path.resolve(__dirname, '../../data/ansd-csv');

// ─── Normalisation de noms pour la correspondance ───────────────

function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── Parseur CSV minimaliste (gère les guillemets) ───────────────

function parseCsvLine(line, sep = ',') {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
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

function detectSeparator(firstLine) {
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  for (const c of firstLine) if (counts[c] !== undefined) counts[c]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const sep = detectSeparator(lines[0]);
  const headers = parseCsvLine(lines[0], sep).map(h => h.toLowerCase().replace(/['"]/g, '').trim());

  // Trouver les colonnes pertinentes
  const nameCol = headers.findIndex(h =>
    /localit|village|nom|name|lieu/i.test(h)
  );
  const popCol = headers.findIndex(h =>
    /popul|effect|total|habitant|recensement/i.test(h)
  );

  if (nameCol === -1 || popCol === -1) {
    return { headers, nameCol, popCol, rows: [] };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i], sep);
    const name = fields[nameCol]?.replace(/^["']|["']$/g, '').trim();
    const popRaw = fields[popCol]?.replace(/\s+/g, '').replace(/[^0-9]/g, '');
    const pop = parseInt(popRaw, 10);
    if (name && !isNaN(pop) && pop > 0) {
      rows.push({ name, population: pop });
    }
  }
  return { headers, nameCol, popCol, rows };
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║        import-population.js                      ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  if (!fs.existsSync(CSV_DIR)) {
    console.error(`\n❌ Dossier CSV introuvable : ${CSV_DIR}`);
    console.error('   Exécutez d\'abord : node src/scripts/download-ansd-csv.js');
    process.exit(1);
  }

  const csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
  if (csvFiles.length === 0) {
    console.error('\n❌ Aucun fichier CSV dans ' + CSV_DIR);
    console.error('   → Placez les CSV ANSD dans ce dossier (nommage: <dep_slug>.csv)');
    process.exit(1);
  }

  console.log(`\n  ${csvFiles.length} CSV trouvés dans ${CSV_DIR}\n`);

  const client = await pool.connect();
  try {
    // S'assurer que la colonne population existe
    await client.query(`
      ALTER TABLE localites ADD COLUMN IF NOT EXISTS population INTEGER
    `);

    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalRows = 0;

    for (const file of csvFiles) {
      const depSlug = path.basename(file, '.csv');
      const content = fs.readFileSync(path.join(CSV_DIR, file), 'utf8');
      const { headers, nameCol, popCol, rows } = parseCsv(content);

      if (!rows || rows.length === 0) {
        console.log(`  ⚠ ${file} : aucune ligne parsée`);
        if (headers) {
          console.log(`    Colonnes détectées : ${headers.join(' | ')}`);
          console.log(`    nameCol=${nameCol} popCol=${popCol}`);
        }
        continue;
      }

      console.log(`\n  📄 ${file} — ${rows.length} localités`);
      totalRows += rows.length;

      let matched = 0;
      let unmatched = 0;

      await client.query('BEGIN');

      for (const row of rows) {
        const normKey = normalizeName(row.name);

        // Tentative 1 : correspondance exacte normalisée
        const { rows: found } = await client.query(`
          SELECT id FROM localites
          WHERE lower(
            regexp_replace(
              unaccent(name),
              '[\\-'\'\\s]+', ' ', 'g'
            )
          ) = $1
          LIMIT 1
        `, [normKey]);

        if (found.length > 0) {
          await client.query(
            'UPDATE localites SET population = $1 WHERE id = $2',
            [row.population, found[0].id]
          );
          matched++;
        } else {
          // Tentative 2 : ILIKE (contient)
          const { rows: found2 } = await client.query(`
            SELECT id FROM localites
            WHERE name ILIKE $1
            LIMIT 1
          `, [`%${row.name}%`]);

          if (found2.length > 0) {
            await client.query(
              'UPDATE localites SET population = $1 WHERE id = $2',
              [row.population, found2[0].id]
            );
            matched++;
          } else {
            unmatched++;
            if (unmatched <= 5) {
              console.log(`    ↳ Non trouvé : "${row.name}" (pop=${row.population})`);
            }
          }
        }
      }

      await client.query('COMMIT');
      console.log(`    ✓ ${matched} correspondances, ${unmatched} non trouvées`);
      totalMatched += matched;
      totalUnmatched += unmatched;
    }

    // ─── Rapport ───────────────────────────────────────────────
    const { rows: [stats] } = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(population) AS with_pop,
        SUM(population) AS total_pop,
        MIN(population) AS min_pop,
        MAX(population) AS max_pop
      FROM localites
    `);

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║           RAPPORT import-population             ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  CSV parsés                   : ${String(csvFiles.length).padStart(10)} ║`);
    console.log(`║  Lignes CSV traitées          : ${String(totalRows).padStart(10)} ║`);
    console.log(`║  Correspondances trouvées     : ${String(totalMatched).padStart(10)} ║`);
    console.log(`║  Non trouvées                 : ${String(totalUnmatched).padStart(10)} ║`);
    console.log(`║  Localités avec population    : ${String(stats.with_pop).padStart(10)} ║`);
    console.log(`║  Population totale importée   : ${String(stats.total_pop).padStart(10)} ║`);
    console.log(`║  Pop min / max                : ${String(stats.min_pop + ' / ' + stats.max_pop).padStart(10)} ║`);
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
