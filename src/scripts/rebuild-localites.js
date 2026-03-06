/**
 * Reconstruction complète de localites_geo depuis senegal.ts
 * 
 * 1. Parse senegal.ts → 25515 localités avec hiérarchie commune/dept/région
 * 2. Mapper chaque commune à son commune_id en base (communes_boundaries)
 * 3. Chercher les coordonnées dans SN.txt + localites.geojson → source "openstreetmap"
 * 4. Fallback centroïde de la commune → source "centroide_commune"
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

function parseSenegalTs(filePath) {
  let raw = fs.readFileSync(filePath, 'utf-8');
  // Retirer "export const senegal = " et le ";" final
  raw = raw.replace(/^export\s+const\s+senegal\s*=\s*/, '');
  raw = raw.replace(/;\s*$/, '');
  // Ajouter des guillemets aux clés non quotées (name: → "name":)
  raw = raw.replace(/(\s)(name|code|lat|lon|elevation|departements|communes|localites)\s*:/g, '$1"$2":');
  // Supprimer les trailing commas (avant ] ou })
  raw = raw.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(raw);
}

async function main() {
  const client = await pool.connect();

  try {
    // ========== ÉTAPE 0 : Parser senegal.ts ==========
    console.log('=== ÉTAPE 0 : Parsing senegal.ts ===');
    const tsPath = path.resolve(__dirname, '..', '..', 'senegal.ts');
    const regions = parseSenegalTs(tsPath);

    // Extraire toutes les localités avec leur hiérarchie
    const allLocalites = [];
    for (const region of regions) {
      for (const dept of region.departements || []) {
        for (const commune of dept.communes || []) {
          for (const loc of commune.localites || []) {
            allLocalites.push({
              name: loc.name,
              communeName: commune.name,
              deptName: dept.name,
              regionName: region.name,
            });
          }
        }
      }
    }

    console.log(`  Régions     : ${regions.length}`);
    console.log(`  Localités   : ${allLocalites.length}`);

    // ========== ÉTAPE 1 : Mapper communes → IDs en base ==========
    console.log('\n=== ÉTAPE 1 : Mapping communes → IDs ===');
    const communesDb = await client.query(`
      SELECT c.commune_id, c.departement_id, c.name AS commune_name,
             d.region_id, d.name AS dept_name, r.name AS region_name
      FROM communes_boundaries c
      JOIN departements_boundaries d ON d.departement_id = c.departement_id
      JOIN regions_boundaries r ON r.region_id = d.region_id
    `);

    // Index: normCommune+normDept → { commune_id, departement_id, region_id }
    const communeIndex = new Map();
    for (const row of communesDb.rows) {
      const key = normalize(row.commune_name) + '|' + normalize(row.dept_name);
      communeIndex.set(key, {
        commune_id: row.commune_id,
        departement_id: row.departement_id,
        region_id: row.region_id,
      });
    }
    // Fallback: par nom de commune seul
    const communeByName = new Map();
    for (const row of communesDb.rows) {
      const key = normalize(row.commune_name);
      if (!communeByName.has(key)) {
        communeByName.set(key, {
          commune_id: row.commune_id,
          departement_id: row.departement_id,
          region_id: row.region_id,
        });
      }
    }

    let mapped = 0, unmapped = 0;
    for (const loc of allLocalites) {
      const key = normalize(loc.communeName) + '|' + normalize(loc.deptName);
      const match = communeIndex.get(key) || communeByName.get(normalize(loc.communeName));
      if (match) {
        loc.commune_id = match.commune_id;
        loc.departement_id = match.departement_id;
        loc.region_id = match.region_id;
        mapped++;
      } else {
        unmapped++;
      }
    }
    console.log(`  Mappées     : ${mapped}`);
    console.log(`  Non mappées : ${unmapped}`);

    // ========== ÉTAPE 2 : Construire index de coordonnées ==========
    console.log('\n=== ÉTAPE 2 : Construction index de coordonnées ===');

    // Index: normName → [{ lat, lng, commune_id? }]
    const coordIndex = new Map();

    // 2a. SN.txt
    const snPath = path.resolve(__dirname, '..', '..', 'SN.txt');
    if (fs.existsSync(snPath)) {
      const snRaw = fs.readFileSync(snPath, 'utf-8');
      const snLines = snRaw.split('\n').filter(l => l.trim());
      let snCount = 0;
      for (const line of snLines) {
        const cols = line.split('\t');
        if (cols.length < 7) continue;
        const lat = parseFloat(cols[4]);
        const lng = parseFloat(cols[5]);
        if (isNaN(lat) || isNaN(lng)) continue;
        const norm = normalize(cols[1]);
        if (!norm) continue;
        if (!coordIndex.has(norm)) coordIndex.set(norm, []);
        coordIndex.get(norm).push({ lat, lng });
        snCount++;
      }
      console.log(`  SN.txt      : ${snCount} entrées indexées`);
    }

    // 2b. localites.geojson
    const gjPath = path.resolve(__dirname, '..', '..', 'localites.geojson');
    if (fs.existsSync(gjPath)) {
      const gjRaw = fs.readFileSync(gjPath, 'utf-8');
      const geojson = JSON.parse(gjRaw);
      let gjCount = 0;
      for (const f of geojson.features) {
        if (!f.properties?.name || !f.geometry?.coordinates) continue;
        if (f.geometry.type !== 'Point') continue;
        const [lng, lat] = f.geometry.coordinates;
        const norm = normalize(f.properties.name);
        if (!norm) continue;
        if (!coordIndex.has(norm)) coordIndex.set(norm, []);
        coordIndex.get(norm).push({ lat, lng });
        gjCount++;
      }
      console.log(`  GeoJSON     : ${gjCount} entrées indexées`);
    }

    console.log(`  Index total : ${coordIndex.size} noms uniques`);

    // ========== ÉTAPE 3 : TRUNCATE + INSERT ==========
    console.log('\n=== ÉTAPE 3 : Import dans localites_geo ===');
    await client.query('TRUNCATE localites_geo RESTART IDENTITY');

    // Pré-calculer les centroïdes des communes
    const centroidResult = await client.query(`
      SELECT commune_id,
             ST_Y(ST_Centroid(geometry)) AS lat,
             ST_X(ST_Centroid(geometry)) AS lng
      FROM communes_boundaries
    `);
    const centroids = new Map();
    for (const row of centroidResult.rows) {
      centroids.set(row.commune_id, { lat: parseFloat(row.lat), lng: parseFloat(row.lng) });
    }

    let withOsm = 0, withCentroid = 0, noCoords = 0;

    for (let i = 0; i < allLocalites.length; i += BATCH_SIZE) {
      const batch = allLocalites.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');

      for (const loc of batch) {
        let lat = null, lng = null, source = null;

        // Chercher dans l'index de coordonnées
        const normName = normalize(loc.name);
        const candidates = coordIndex.get(normName);
        if (candidates && candidates.length > 0) {
          // Prendre le premier match
          lat = candidates[0].lat;
          lng = candidates[0].lng;
          source = 'openstreetmap';
          withOsm++;
        } else if (loc.commune_id && centroids.has(loc.commune_id)) {
          // Fallback centroïde
          const c = centroids.get(loc.commune_id);
          lat = c.lat;
          lng = c.lng;
          source = 'centroide_commune';
          withCentroid++;
        } else {
          noCoords++;
        }

        await client.query(`
          INSERT INTO localites_geo (name, commune_id, departement_id, region_id, latitude, longitude, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [loc.name, loc.commune_id || null, loc.departement_id || null,
            loc.region_id || null, lat, lng, source]);
      }

      await client.query('COMMIT');
      const pct = Math.round((Math.min(i + BATCH_SIZE, allLocalites.length) / allLocalites.length) * 100);
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, allLocalites.length)}/${allLocalites.length} (${pct}%)`);
    }

    console.log('\n');

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
