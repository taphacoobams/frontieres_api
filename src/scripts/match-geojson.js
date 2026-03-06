/**
 * Correspondance localites.geojson → localites_geo
 * 
 * 1. Lit localites.geojson (OSM features avec coordinates)
 * 2. Normalise les noms pour comparaison fuzzy
 * 3. Met à jour les coordonnées des localités déjà en base si meilleure source
 * 4. Insère les localités GeoJSON non trouvées en base (nouvelles)
 */
const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_'/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const filePath = path.resolve(__dirname, '..', '..', 'localites.geojson');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const geojson = JSON.parse(raw);

  // Filtrer les features avec un nom et des coordonnées Point
  const features = geojson.features.filter(f =>
    f.properties &&
    f.properties.name &&
    f.geometry &&
    f.geometry.type === 'Point' &&
    f.geometry.coordinates &&
    f.geometry.coordinates.length === 2
  );

  console.log(`localites.geojson : ${geojson.features.length} features total`);
  console.log(`  Avec nom + Point : ${features.length}`);

  const client = await pool.connect();

  try {
    // Charger toutes les localités existantes avec leur nom normalisé
    const existingResult = await client.query(
      'SELECT id, name, commune_id, latitude, longitude, source FROM localites_geo'
    );

    // Construire un index par nom normalisé (peut avoir plusieurs entrées)
    const byNormName = new Map();
    for (const row of existingResult.rows) {
      const norm = normalize(row.name);
      if (!byNormName.has(norm)) byNormName.set(norm, []);
      byNormName.get(norm).push(row);
    }

    let updated = 0;
    let inserted = 0;
    let skippedNoName = 0;
    let noMatch = 0;

    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const name = f.properties.name;
      const normName = normalize(name);
      const [lng, lat] = f.geometry.coordinates;

      if (!normName) {
        skippedNoName++;
        continue;
      }

      const candidates = byNormName.get(normName);

      if (candidates && candidates.length > 0) {
        // Trouver la commune du point GeoJSON par spatial join
        const communeResult = await client.query(`
          SELECT commune_id FROM communes_boundaries
          WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          LIMIT 1
        `, [lng, lat]);

        const geojsonCommuneId = communeResult.rows.length > 0
          ? communeResult.rows[0].commune_id
          : null;

        // Chercher la meilleure correspondance (même commune si possible)
        let best = candidates[0];
        if (geojsonCommuneId) {
          const sameCommune = candidates.find(c => c.commune_id === geojsonCommuneId);
          if (sameCommune) best = sameCommune;
        }

        // Mettre à jour si source = sn_txt (OSM est plus précis pour les points)
        if (best.source === 'sn_txt') {
          await client.query(`
            UPDATE localites_geo
            SET latitude = $1, longitude = $2, source = 'geojson'
            WHERE id = $3
          `, [lat, lng, best.id]);
          updated++;
        }
      } else {
        // Localité non trouvée en base : l'insérer
        const spatialResult = await client.query(`
          SELECT 
            c.commune_id,
            c.departement_id,
            d.region_id
          FROM communes_boundaries c
          JOIN departements_boundaries d ON d.departement_id = c.departement_id
          WHERE ST_Contains(c.geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          LIMIT 1
        `, [lng, lat]);

        let communeId = null, departementId = null, regionId = null;
        if (spatialResult.rows.length > 0) {
          communeId = spatialResult.rows[0].commune_id;
          departementId = spatialResult.rows[0].departement_id;
          regionId = spatialResult.rows[0].region_id;
        }

        await client.query(`
          INSERT INTO localites_geo (name, commune_id, departement_id, region_id, latitude, longitude, source)
          VALUES ($1, $2, $3, $4, $5, $6, 'geojson')
        `, [name, communeId, departementId, regionId, lat, lng]);
        inserted++;
      }

      if ((i + 1) % 1000 === 0) {
        const pct = Math.round(((i + 1) / features.length) * 100);
        process.stdout.write(`\r  ${i + 1}/${features.length} (${pct}%)`);
      }
    }

    console.log(`\r  ${features.length}/${features.length} (100%)`);
    console.log(`\n✓ Correspondance GeoJSON terminée :`);
    console.log(`  Mises à jour (coords améliorées) : ${updated}`);
    console.log(`  Nouvelles localités insérées      : ${inserted}`);
    console.log(`  Sans nom (ignorées)               : ${skippedNoName}`);

    // Stats finales
    const stats = await client.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(commune_id) AS with_commune,
        COUNT(latitude) AS with_coords,
        COUNT(*) FILTER (WHERE source = 'sn_txt') AS from_sntxt,
        COUNT(*) FILTER (WHERE source = 'geojson') AS from_geojson
      FROM localites_geo
    `);
    const s = stats.rows[0];
    console.log(`\n  Stats base :`);
    console.log(`    Total        : ${s.total}`);
    console.log(`    Avec commune : ${s.with_commune}`);
    console.log(`    Avec coords  : ${s.with_coords}`);
    console.log(`    Source SN.txt: ${s.from_sntxt}`);
    console.log(`    Source GeoJSON: ${s.from_geojson}`);

  } catch (err) {
    console.error('Erreur correspondance :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
