/**
 * Script d'import des fichiers GeoJSON dans PostGIS
 *
 * Usage : npm run import
 *
 * Lit les trois fichiers geoBoundaries (ADM1, ADM2, ADM3),
 * nettoie les noms, et insère dans PostGIS.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

// ---------- Configuration ----------

const DATA_DIR = path.resolve(__dirname, '..', '..');

const FILES = {
  regions: path.join(DATA_DIR, 'geoBoundaries-SEN-ADM1_simplified.geojson'),
  departements: path.join(DATA_DIR, 'geoBoundaries-SEN-ADM2_simplified.geojson'),
  communes: path.join(DATA_DIR, 'communes.geojson'),
};

// ---------- Nettoyage des noms ----------

const NAME_PREFIXES = [
  /^Commune\s+de\s+/i,
  /^Communauté\s+rurale\s+de\s+/i,
  /^Communauté\s+rurale\s+d['']?\s*/i,
  /^Commune\s+d['']?\s*/i,
  /^Région\s+de\s+/i,
  /^Région\s+d['']?\s*/i,
  /^Département\s+de\s+/i,
  /^Département\s+d['']?\s*/i,
  /^Arrondissement\s+de\s+/i,
  /^Arrondissement\s+d['']?\s*/i,
];

function cleanName(rawName) {
  if (!rawName) return 'Sans nom';
  let name = rawName.trim();
  for (const prefix of NAME_PREFIXES) {
    name = name.replace(prefix, '');
  }
  return name.trim() || rawName.trim();
}

// ---------- Filtrage des features ----------

function filterPolygonFeatures(features, adminLevel) {
  return features.filter((f) => {
    const type = f.geometry && f.geometry.type;
    const isPolygon = type === 'Polygon' || type === 'MultiPolygon';
    if (!isPolygon) return false;
    if (adminLevel) {
      return f.properties.admin_level === String(adminLevel);
    }
    return true;
  });
}

// ---------- Conversion Polygon → MultiPolygon ----------

function toMultiPolygon(geometry) {
  if (geometry.type === 'MultiPolygon') {
    return geometry;
  }
  // Wrap Polygon into MultiPolygon
  return {
    type: 'MultiPolygon',
    coordinates: [geometry.coordinates],
  };
}

// ---------- Import des régions ----------

async function importRegions(client) {
  console.log('\n--- Import des régions (ADM1) ---');
  const raw = fs.readFileSync(FILES.regions, 'utf-8');
  const geojson = JSON.parse(raw);
  const features = filterPolygonFeatures(geojson.features);
  console.log(`  ${geojson.features.length} features lues, ${features.length} polygones conservés`);

  await client.query('TRUNCATE regions_boundaries RESTART IDENTITY CASCADE');

  let count = 0;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const name = cleanName(f.properties.shapeName || f.properties.name);
    const geometry = toMultiPolygon(f.geometry);
    const regionId = i + 1;

    await client.query(
      `INSERT INTO regions_boundaries (region_id, name, geometry)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))`,
      [regionId, name, JSON.stringify(geometry)]
    );
    count++;
  }

  console.log(`  ${count} régions importées.`);
  return count;
}

// ---------- Import des départements ----------

async function importDepartements(client) {
  console.log('\n--- Import des départements (ADM2) ---');
  const raw = fs.readFileSync(FILES.departements, 'utf-8');
  const geojson = JSON.parse(raw);
  const features = filterPolygonFeatures(geojson.features);
  console.log(`  ${geojson.features.length} features lues, ${features.length} polygones conservés`);

  await client.query('TRUNCATE departements_boundaries RESTART IDENTITY CASCADE');

  let count = 0;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const name = cleanName(f.properties.shapeName || f.properties.name);
    const geometry = toMultiPolygon(f.geometry);
    const departementId = i + 1;

    // Trouver la région parente par intersection spatiale
    let regionId = null;
    const matchResult = await client.query(
      `SELECT rb.region_id
       FROM regions_boundaries rb
       WHERE ST_Intersects(rb.geometry, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
       ORDER BY ST_Area(ST_Intersection(rb.geometry, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))) DESC
       LIMIT 1`,
      [JSON.stringify(geometry)]
    );
    if (matchResult.rows.length > 0) {
      regionId = matchResult.rows[0].region_id;
    }

    await client.query(
      `INSERT INTO departements_boundaries (departement_id, region_id, name, geometry)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))`,
      [departementId, regionId, name, JSON.stringify(geometry)]
    );
    count++;
    process.stdout.write(`  ${count}/${features.length} départements insérés...\r`);
  }

  console.log(`  ${count} départements importés.`);
  return count;
}

// ---------- Import des communes ----------

async function importCommunes(client) {
  console.log('\n--- Import des communes ---');
  const raw = fs.readFileSync(FILES.communes, 'utf-8');
  const geojson = JSON.parse(raw);
  const features = filterPolygonFeatures(geojson.features, 8);
  console.log(`  ${geojson.features.length} features lues, ${features.length} polygones (admin_level=8) conservés`);

  await client.query('TRUNCATE communes_boundaries RESTART IDENTITY CASCADE');

  let count = 0;
  const batchSize = 10;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const name = cleanName(f.properties.name || f.properties['name:fr']);
    const geometry = toMultiPolygon(f.geometry);
    const communeId = i + 1;

    // Trouver le département parent par intersection spatiale
    let departementId = null;
    const matchResult = await client.query(
      `SELECT db.departement_id
       FROM departements_boundaries db
       WHERE ST_Intersects(db.geometry, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
       ORDER BY ST_Area(ST_Intersection(db.geometry, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))) DESC
       LIMIT 1`,
      [JSON.stringify(geometry)]
    );
    if (matchResult.rows.length > 0) {
      departementId = matchResult.rows[0].departement_id;
    }

    await client.query(
      `INSERT INTO communes_boundaries (commune_id, departement_id, name, geometry)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))`,
      [communeId, departementId, name, JSON.stringify(geometry)]
    );
    count++;

    if (count % batchSize === 0) {
      process.stdout.write(`  ${count}/${features.length} communes insérées...\r`);
    }
  }

  console.log(`  ${count} communes importées.`);
  return count;
}

// ---------- Main ----------

async function main() {
  console.log('=== Import GeoJSON → PostGIS ===');
  console.log(`Répertoire des données : ${DATA_DIR}`);

  // Vérifier que les fichiers existent
  for (const [key, filePath] of Object.entries(FILES)) {
    if (!fs.existsSync(filePath)) {
      console.error(`Fichier introuvable : ${filePath}`);
      process.exit(1);
    }
    console.log(`  ✓ ${key}: ${filePath}`);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const regionsCount = await importRegions(client);
    const departementsCount = await importDepartements(client);
    const communesCount = await importCommunes(client);

    await client.query('COMMIT');

    console.log('\n=== Import terminé avec succès ===');
    console.log(`  Régions     : ${regionsCount}`);
    console.log(`  Départements: ${departementsCount}`);
    console.log(`  Communes    : ${communesCount}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nErreur lors de l\'import :', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
