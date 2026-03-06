/**
 * Enrichissement de la table localites avec les élévations (SRTM30m)
 * Source : https://api.opentopodata.org/v1/srtm30m
 *
 * - 100 points max par requête
 * - 1 requête/seconde (délai 1100ms entre chaque batch)
 * - Relance automatique en cas d'erreur 429 ou 5xx
 */

const pool = require('../database/connection');

const BATCH_SIZE = 100;
const DELAY_MS = 1100;
const MAX_RETRIES = 3;
const OPENTOPODATA_URL = 'https://api.opentopodata.org/v1/srtm30m';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchElevations(locations, attempt = 1) {
  const locStr = locations.map(l => `${l.latitude},${l.longitude}`).join('|');
  const url = `${OPENTOPODATA_URL}?locations=${locStr}`;

  const res = await fetch(url);

  if (res.status === 429 || res.status >= 500) {
    if (attempt <= MAX_RETRIES) {
      const wait = DELAY_MS * attempt * 2;
      console.warn(`  ⚠ Erreur ${res.status} — nouvelle tentative dans ${wait}ms (${attempt}/${MAX_RETRIES})`);
      await sleep(wait);
      return fetchElevations(locations, attempt + 1);
    }
    throw new Error(`Erreur API opentopodata : ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(`Erreur API opentopodata : ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.status !== 'OK') {
    throw new Error(`Réponse API invalide : ${JSON.stringify(data)}`);
  }
  return data.results;
}

async function main() {
  const client = await pool.connect();

  try {
    // Ajouter la colonne elevation si elle n'existe pas
    await client.query(`
      ALTER TABLE localites
      ADD COLUMN IF NOT EXISTS elevation INTEGER
    `);
    console.log('✓ Colonne elevation présente dans la table localites');

    // Charger les localités avec coordonnées mais sans élévation
    const { rows } = await client.query(`
      SELECT id, latitude, longitude
      FROM localites
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND elevation IS NULL
      ORDER BY id
    `);

    const total = rows.length;
    console.log(`\n${total} localités à enrichir avec l'élévation\n`);

    if (total === 0) {
      console.log('Toutes les localités ont déjà une élévation.');
      return;
    }

    let processed = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      let results;
      try {
        results = await fetchElevations(batch);
      } catch (err) {
        console.error(`  ✗ Batch ${Math.floor(i / BATCH_SIZE) + 1} échoué : ${err.message}`);
        errors += batch.length;
        await sleep(DELAY_MS);
        continue;
      }

      // Mettre à jour les élévations en base
      await client.query('BEGIN');
      for (let j = 0; j < results.length; j++) {
        const elevation = results[j].elevation;
        const id = batch[j].id;
        if (elevation !== null && elevation !== undefined) {
          await client.query(
            'UPDATE localites SET elevation = $1 WHERE id = $2',
            [Math.round(elevation), id]
          );
        }
      }
      await client.query('COMMIT');

      processed += batch.length;
      const pct = ((processed / total) * 100).toFixed(1);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
      process.stdout.write(`\r  Batch ${batchNum}/${totalBatches} — ${processed}/${total} (${pct}%)`);

      // Délai entre les requêtes pour respecter le rate limit
      if (i + BATCH_SIZE < rows.length) {
        await sleep(DELAY_MS);
      }
    }

    // Rapport final
    const stats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE elevation IS NOT NULL) AS with_elevation,
        COUNT(*) FILTER (WHERE elevation IS NULL) AS without_elevation,
        MIN(elevation) AS min_elev,
        MAX(elevation) AS max_elev,
        ROUND(AVG(elevation)) AS avg_elev
      FROM localites
      WHERE latitude IS NOT NULL
    `);
    const s = stats.rows[0];

    console.log('\n\n╔════════════════════════════════════════════════╗');
    console.log('║            RAPPORT ÉLÉVATIONS                 ║');
    console.log('╠════════════════════════════════════════════════╣');
    console.log(`║  Localités avec élévation    : ${String(s.with_elevation).padStart(10)} ║`);
    console.log(`║  Localités sans élévation    : ${String(s.without_elevation).padStart(10)} ║`);
    console.log(`║  Élévation min (m)           : ${String(s.min_elev).padStart(10)} ║`);
    console.log(`║  Élévation max (m)           : ${String(s.max_elev).padStart(10)} ║`);
    console.log(`║  Élévation moyenne (m)       : ${String(s.avg_elev).padStart(10)} ║`);
    if (errors > 0) {
      console.log(`║  Erreurs (batches échoués)   : ${String(errors).padStart(10)} ║`);
    }
    console.log('╚════════════════════════════════════════════════╝');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nErreur :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
