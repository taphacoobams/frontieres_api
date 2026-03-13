/**
 * update-elevation.js
 * Calcule l'altitude (elevation) pour les régions, départements et communes
 * en utilisant l'API Open-Meteo Elevation (gratuite, sans clé API).
 *
 * Usage :
 *   node src/scripts/update-elevation.js [--tables regions,departements,communes]
 */

require('dotenv').config();
const https = require('https');
const pool = require('../database/connection');

// Tables à mettre à jour (dans l'ordre)
const DEFAULT_TABLES = ['regions', 'departements', 'communes'];

// Open-Meteo accepte jusqu'à 100 points par requête
const BATCH_SIZE = 100;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function fetchElevations(lats, lons) {
  const latStr = lats.join(',');
  const lonStr = lons.join(',');
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${latStr}&longitude=${lonStr}`;
  const data = await httpsGet(url);
  if (!data.elevation) {
    throw new Error(`Réponse inattendue Open-Meteo : ${JSON.stringify(data)}`);
  }
  return data.elevation; // tableau de valeurs (mètres, arrondi à l'entier)
}

async function updateTableElevation(tableName) {
  console.log(`\n--- ${tableName} ---`);

  // Récupérer les lignes qui ont lat/lon mais pas d'altitude encore
  const { rows } = await pool.query(
    `SELECT id, lat, lon FROM ${tableName}
     WHERE lat IS NOT NULL AND lon IS NOT NULL
     ORDER BY id`
  );

  if (rows.length === 0) {
    console.log('  Aucune ligne avec coordonnées trouvée.');
    return;
  }

  console.log(`  ${rows.length} enregistrement(s) à traiter...`);
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const lats = batch.map((r) => r.lat);
    const lons = batch.map((r) => r.lon);

    let elevations;
    try {
      elevations = await fetchElevations(lats, lons);
    } catch (err) {
      console.error(`  Erreur API pour le lot ${i / BATCH_SIZE + 1} :`, err.message);
      continue;
    }

    // Mise à jour en masse via un UPDATE … FROM (VALUES …)
    const values = batch
      .map((r, j) => `(${r.id}, ${elevations[j]})`)
      .join(', ');

    await pool.query(
      `UPDATE ${tableName} AS t
       SET elevation = v.elevation::numeric
       FROM (VALUES ${values}) AS v(id, elevation)
       WHERE t.id = v.id`
    );

    updated += batch.length;
    console.log(`  Lot ${i / BATCH_SIZE + 1} : ${batch.length} mise(s) à jour (total: ${updated})`);

    // Petite pause pour respecter les limites de l'API
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(`  ✓ ${updated} enregistrement(s) mis à jour dans ${tableName}`);
}

async function main() {
  // Lire --tables depuis les arguments CLI si fourni
  const tablesArg = process.argv.find((a) => a.startsWith('--tables='));
  const tables = tablesArg
    ? tablesArg.replace('--tables=', '').split(',').map((t) => t.trim())
    : DEFAULT_TABLES;

  // Validation : seulement les tables autorisées
  const allowed = new Set(['regions', 'departements', 'communes']);
  for (const t of tables) {
    if (!allowed.has(t)) {
      console.error(`Table non autorisée : "${t}". Valeurs acceptées : regions, departements, communes`);
      process.exit(1);
    }
  }

  console.log(`Mise à jour de l'altitude pour : ${tables.join(', ')}`);
  console.log('Source : Open-Meteo Elevation API (https://open-meteo.com)');

  for (const table of tables) {
    await updateTableElevation(table);
  }

  console.log('\nTerminé.');
  await pool.end();
}

main().catch((err) => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
