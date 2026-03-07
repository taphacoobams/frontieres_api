/**
 * import-pays.js
 * Importe le polygone national du Sénégal depuis sen_admin0_em.geojson,
 * calcule la superficie via PostGIS, additionne la population depuis localites,
 * et calcule la densité.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const GEOJSON_PATH = path.join(
  __dirname, '../../sen_admin_boundaries.geojson/sen_admin0_em.geojson'
);

async function main() {
  console.log('╔════════════════════════════════════╗');
  console.log('║       import-pays.js               ║');
  console.log('╚════════════════════════════════════╝\n');

  const client = await pool.connect();
  try {
    // 1. Lire le GeoJSON
    console.log('=== 1. Lecture du GeoJSON ===');
    const raw = fs.readFileSync(GEOJSON_PATH, 'utf8');
    const geojson = JSON.parse(raw);
    const feature = geojson.features[0];
    if (!feature) throw new Error('Aucune feature trouvée dans sen_admin0_em.geojson');
    const geomStr = JSON.stringify(feature.geometry);
    const name = feature.properties.adm0_name || 'Sénégal';
    console.log(`  ✓ Feature trouvée : ${name}\n`);

    // 2. Vider la table et insérer
    console.log('=== 2. Insertion dans la table pays ===');
    await client.query('TRUNCATE pays RESTART IDENTITY');
    await client.query(
      'INSERT INTO pays (name, geometry) VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))',
      [name, geomStr]
    );
    console.log('  ✓ Polygone inséré\n');

    // 3. Calculer la superficie
    console.log('=== 3. Calcul superficie ===');
    await client.query(`
      UPDATE pays
      SET superficie_km2 = ST_Area(geometry::geography) / 1000000
    `);
    const { rows: sup } = await client.query('SELECT superficie_km2 FROM pays LIMIT 1');
    console.log(`  ✓ superficie_km2 = ${sup[0].superficie_km2.toFixed(2)} km²\n`);

    // 4. Calculer la population (somme des localités)
    console.log('=== 4. Calcul population ===');
    await client.query(`
      UPDATE pays
      SET population = (SELECT COALESCE(SUM(population), 0) FROM localites)
    `);
    const { rows: pop } = await client.query('SELECT population FROM pays LIMIT 1');
    console.log(`  ✓ population = ${pop[0].population.toLocaleString('fr-FR')} habitants\n`);

    // 5. Calculer la densité
    console.log('=== 5. Calcul densité ===');
    await client.query(`
      UPDATE pays
      SET densite = CASE WHEN superficie_km2 > 0 THEN population::float / superficie_km2 ELSE NULL END
    `);
    const { rows: den } = await client.query('SELECT densite FROM pays LIMIT 1');
    console.log(`  ✓ densite = ${den[0].densite.toFixed(2)} hab/km²\n`);

    console.log('✅ Import pays terminé avec succès.');
  } catch (err) {
    console.error('Erreur fatale :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
