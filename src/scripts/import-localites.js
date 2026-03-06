/**
 * Import des localités depuis SN.txt (format GeoNames) vers localites_geo
 * 
 * Colonnes GeoNames (tab-separated) :
 * 0: geonameid, 1: name, 2: asciiname, 3: alternatenames,
 * 4: latitude, 5: longitude, 6: feature_class, 7: feature_code,
 * 8: country_code, 9: cc2, 10: admin1_code, 11: admin2_code,
 * 12: admin3_code, 13: admin4_code, 14: population, 15: elevation,
 * 16: dem, 17: timezone, 18: modification_date
 * 
 * On importe uniquement les feature_class = "P" (populated places)
 * et on associe chaque localité à sa commune/département/région
 * par intersection spatiale (ST_Contains).
 */
const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const BATCH_SIZE = 500;

async function main() {
  const filePath = path.resolve(__dirname, '..', '..', 'SN.txt');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  // Filtrer les populated places (feature_class = P)
  const places = [];
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols[6] === 'P') {
      places.push({
        geonameid: parseInt(cols[0], 10),
        name: cols[1],
        lat: parseFloat(cols[4]),
        lng: parseFloat(cols[5]),
      });
    }
  }

  console.log(`SN.txt : ${lines.length} lignes, ${places.length} localités (PPL)`);

  const client = await pool.connect();

  try {
    // Vérifier si la table est déjà remplie
    const existing = await client.query('SELECT COUNT(*) FROM localites_geo');
    if (parseInt(existing.rows[0].count) > 0) {
      console.log(`Table localites_geo contient déjà ${existing.rows[0].count} entrées.`);
      console.log('Vidage de la table...');
      await client.query('TRUNCATE localites_geo RESTART IDENTITY');
    }

    console.log(`Import de ${places.length} localités...`);

    let inserted = 0;

    for (let i = 0; i < places.length; i += BATCH_SIZE) {
      const batch = places.slice(i, i + BATCH_SIZE);

      await client.query('BEGIN');

      for (const place of batch) {
        // Trouver la commune, le département et la région par intersection spatiale
        const spatialResult = await client.query(`
          SELECT 
            c.commune_id,
            c.departement_id,
            d.region_id
          FROM communes_boundaries c
          JOIN departements_boundaries d ON d.departement_id = c.departement_id
          WHERE ST_Contains(c.geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          LIMIT 1
        `, [place.lng, place.lat]);

        let communeId = null;
        let departementId = null;
        let regionId = null;

        if (spatialResult.rows.length > 0) {
          communeId = spatialResult.rows[0].commune_id;
          departementId = spatialResult.rows[0].departement_id;
          regionId = spatialResult.rows[0].region_id;
        }

        await client.query(`
          INSERT INTO localites_geo (geonameid, name, commune_id, departement_id, region_id, latitude, longitude, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'sn_txt')
        `, [place.geonameid, place.name, communeId, departementId, regionId, place.lat, place.lng]);

        inserted++;
      }

      await client.query('COMMIT');

      const pct = Math.round((Math.min(i + BATCH_SIZE, places.length) / places.length) * 100);
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, places.length)}/${places.length} (${pct}%)`);
    }

    console.log('\n');

    // Stats
    const stats = await client.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(commune_id) AS with_commune,
        COUNT(latitude) AS with_coords
      FROM localites_geo
    `);
    const s = stats.rows[0];
    console.log(`✓ Import terminé :`);
    console.log(`  Total localités  : ${s.total}`);
    console.log(`  Avec commune     : ${s.with_commune}`);
    console.log(`  Avec coordonnées : ${s.with_coords}`);
    console.log(`  Sans commune     : ${parseInt(s.total) - parseInt(s.with_commune)}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur import :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
