/**
 * Reconstruction complète de localites_geo
 * 
 * 1. TRUNCATE localites_geo
 * 2. Import TOUTES les entrées de SN.txt (14102, toutes classes)
 *    → association commune par ST_Contains
 *    → source: "openstreetmap"
 * 3. Import localités supplémentaires depuis localites.geojson
 *    → celles qui n'existent pas déjà (par nom normalisé + commune)
 *    → source: "openstreetmap"
 * 4. Fallback centroïde pour localités sans coordonnées ou sans commune
 *    → source: "centroide_commune"
 */
const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const BATCH_SIZE = 500;

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
  const client = await pool.connect();

  try {
    // ========== ÉTAPE 0 : TRUNCATE ==========
    console.log('=== ÉTAPE 0 : Vidage de localites_geo ===');
    await client.query('TRUNCATE localites_geo RESTART IDENTITY');
    console.log('  Table vidée.\n');

    // ========== ÉTAPE 1 : IMPORT SN.txt (toutes entrées) ==========
    console.log('=== ÉTAPE 1 : Import SN.txt (toutes classes) ===');
    const snPath = path.resolve(__dirname, '..', '..', 'SN.txt');
    const snRaw = fs.readFileSync(snPath, 'utf-8');
    const snLines = snRaw.split('\n').filter(l => l.trim());

    const snPlaces = [];
    for (const line of snLines) {
      const cols = line.split('\t');
      if (cols.length < 7) continue;
      const lat = parseFloat(cols[4]);
      const lng = parseFloat(cols[5]);
      if (isNaN(lat) || isNaN(lng)) continue;
      snPlaces.push({
        geonameid: parseInt(cols[0], 10),
        name: cols[1],
        lat,
        lng,
      });
    }

    console.log(`  Entrées valides dans SN.txt : ${snPlaces.length}`);

    let snInserted = 0;
    for (let i = 0; i < snPlaces.length; i += BATCH_SIZE) {
      const batch = snPlaces.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');

      for (const place of batch) {
        const spatialResult = await client.query(`
          SELECT c.commune_id, c.departement_id, d.region_id
          FROM communes_boundaries c
          JOIN departements_boundaries d ON d.departement_id = c.departement_id
          WHERE ST_Contains(c.geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          LIMIT 1
        `, [place.lng, place.lat]);

        let communeId = null, departementId = null, regionId = null;
        if (spatialResult.rows.length > 0) {
          communeId = spatialResult.rows[0].commune_id;
          departementId = spatialResult.rows[0].departement_id;
          regionId = spatialResult.rows[0].region_id;
        }

        await client.query(`
          INSERT INTO localites_geo (geonameid, name, commune_id, departement_id, region_id, latitude, longitude, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'openstreetmap')
        `, [place.geonameid, place.name, communeId, departementId, regionId, place.lat, place.lng]);
        snInserted++;
      }

      await client.query('COMMIT');
      const pct = Math.round((Math.min(i + BATCH_SIZE, snPlaces.length) / snPlaces.length) * 100);
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, snPlaces.length)}/${snPlaces.length} (${pct}%)`);
    }

    console.log(`\n  ✓ SN.txt importé : ${snInserted} localités\n`);

    // ========== ÉTAPE 2 : IMPORT localites.geojson (nouvelles uniquement) ==========
    console.log('=== ÉTAPE 2 : Enrichissement avec localites.geojson ===');
    const geojsonPath = path.resolve(__dirname, '..', '..', 'localites.geojson');
    const geojsonRaw = fs.readFileSync(geojsonPath, 'utf-8');
    const geojson = JSON.parse(geojsonRaw);

    const features = geojson.features.filter(f =>
      f.properties && f.properties.name &&
      f.geometry && f.geometry.type === 'Point' &&
      f.geometry.coordinates && f.geometry.coordinates.length === 2
    );

    console.log(`  Features GeoJSON avec nom : ${features.length}`);

    // Construire index des localités existantes par nom normalisé
    const existingResult = await client.query(
      'SELECT id, name, commune_id FROM localites_geo'
    );
    // Map: normalizedName → Set of commune_ids
    const existingIndex = new Map();
    for (const row of existingResult.rows) {
      const norm = normalize(row.name);
      if (!existingIndex.has(norm)) existingIndex.set(norm, new Set());
      existingIndex.get(norm).add(row.commune_id);
    }

    let gjInserted = 0;
    let gjSkipped = 0;

    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const name = f.properties.name;
      const normName = normalize(name);
      const [lng, lat] = f.geometry.coordinates;

      if (!normName) continue;

      // Trouver la commune de ce point
      const communeResult = await client.query(`
        SELECT c.commune_id, c.departement_id, d.region_id
        FROM communes_boundaries c
        JOIN departements_boundaries d ON d.departement_id = c.departement_id
        WHERE ST_Contains(c.geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        LIMIT 1
      `, [lng, lat]);

      let communeId = null, departementId = null, regionId = null;
      if (communeResult.rows.length > 0) {
        communeId = communeResult.rows[0].commune_id;
        departementId = communeResult.rows[0].departement_id;
        regionId = communeResult.rows[0].region_id;
      }

      // Vérifier si cette localité existe déjà (même nom normalisé + même commune)
      const existingSet = existingIndex.get(normName);
      if (existingSet && existingSet.has(communeId)) {
        gjSkipped++;
        continue;
      }

      await client.query(`
        INSERT INTO localites_geo (name, commune_id, departement_id, region_id, latitude, longitude, source)
        VALUES ($1, $2, $3, $4, $5, $6, 'openstreetmap')
      `, [name, communeId, departementId, regionId, lat, lng]);

      // Mettre à jour l'index
      if (!existingIndex.has(normName)) existingIndex.set(normName, new Set());
      existingIndex.get(normName).add(communeId);

      gjInserted++;

      if ((i + 1) % 1000 === 0) {
        const pct = Math.round(((i + 1) / features.length) * 100);
        process.stdout.write(`\r  ${i + 1}/${features.length} (${pct}%)`);
      }
    }

    console.log(`\r  ${features.length}/${features.length} (100%)`);
    console.log(`  ✓ GeoJSON : ${gjInserted} nouvelles, ${gjSkipped} doublons ignorés\n`);

    // ========== ÉTAPE 3 : FALLBACK pour localités sans commune ==========
    console.log('=== ÉTAPE 3 : Fallback commune la plus proche ===');
    const noCommune = await client.query(
      'SELECT id, latitude, longitude FROM localites_geo WHERE commune_id IS NULL AND latitude IS NOT NULL'
    );
    console.log(`  Localités sans commune : ${noCommune.rows.length}`);

    let assigned = 0;
    for (const loc of noCommune.rows) {
      const result = await client.query(`
        SELECT c.commune_id, c.departement_id, d.region_id
        FROM communes_boundaries c
        JOIN departements_boundaries d ON d.departement_id = c.departement_id
        ORDER BY c.geometry <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        LIMIT 1
      `, [loc.longitude, loc.latitude]);

      if (result.rows.length > 0) {
        const r = result.rows[0];
        await client.query(
          'UPDATE localites_geo SET commune_id = $1, departement_id = $2, region_id = $3 WHERE id = $4',
          [r.commune_id, r.departement_id, r.region_id, loc.id]
        );
        assigned++;
      }
    }
    console.log(`  ✓ ${assigned} localités assignées à la commune proche\n`);

    // ========== ÉTAPE 4 : Localités sans coordonnées → centroïde ==========
    console.log('=== ÉTAPE 4 : Centroïde pour localités sans coordonnées ===');
    const noCoords = await client.query(
      'SELECT id, commune_id FROM localites_geo WHERE latitude IS NULL AND commune_id IS NOT NULL'
    );
    console.log(`  Localités sans coordonnées : ${noCoords.rows.length}`);

    let centroidFixed = 0;
    for (const loc of noCoords.rows) {
      const centroid = await client.query(`
        SELECT ST_Y(ST_Centroid(geometry)) AS lat, ST_X(ST_Centroid(geometry)) AS lng
        FROM communes_boundaries WHERE commune_id = $1
      `, [loc.commune_id]);

      if (centroid.rows.length > 0) {
        await client.query(
          `UPDATE localites_geo SET latitude = $1, longitude = $2, source = 'centroide_commune' WHERE id = $3`,
          [centroid.rows[0].lat, centroid.rows[0].lng, loc.id]
        );
        centroidFixed++;
      }
    }
    console.log(`  ✓ ${centroidFixed} localités avec centroïde commune\n`);

    // ========== STATS FINALES ==========
    console.log('=== RÉSULTAT FINAL ===');
    const stats = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(commune_id) AS with_commune,
        COUNT(latitude) AS with_coords,
        COUNT(*) FILTER (WHERE commune_id IS NULL) AS no_commune,
        COUNT(*) FILTER (WHERE latitude IS NULL) AS no_coords,
        COUNT(*) FILTER (WHERE source = 'openstreetmap') AS src_osm,
        COUNT(*) FILTER (WHERE source = 'centroide_commune') AS src_centroid
      FROM localites_geo
    `);
    const s = stats.rows[0];
    console.log(`  Total localités          : ${s.total}`);
    console.log(`  Avec commune             : ${s.with_commune}`);
    console.log(`  Avec coordonnées         : ${s.with_coords}`);
    console.log(`  Sans commune             : ${s.no_commune}`);
    console.log(`  Sans coordonnées         : ${s.no_coords}`);
    console.log(`  Source openstreetmap      : ${s.src_osm}`);
    console.log(`  Source centroide_commune  : ${s.src_centroid}`);

    // Stats par région
    const byRegion = await client.query(`
      SELECT r.name AS region, COUNT(l.id) AS count
      FROM localites_geo l
      JOIN regions_boundaries r ON r.region_id = l.region_id
      GROUP BY r.name ORDER BY count DESC
    `);
    console.log('\n  Par région :');
    for (const row of byRegion.rows) {
      console.log(`    ${row.region}: ${row.count}`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
