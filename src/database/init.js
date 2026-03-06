const pool = require('./connection');

const initSQL = `
-- Activer PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Table des régions
CREATE TABLE IF NOT EXISTS regions_boundaries (
  id SERIAL PRIMARY KEY,
  region_id INTEGER,
  name TEXT NOT NULL,
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
);

-- Table des départements
CREATE TABLE IF NOT EXISTS departements_boundaries (
  id SERIAL PRIMARY KEY,
  departement_id INTEGER,
  region_id INTEGER,
  name TEXT NOT NULL,
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
);

-- Table des communes
CREATE TABLE IF NOT EXISTS communes_boundaries (
  id SERIAL PRIMARY KEY,
  commune_id INTEGER,
  departement_id INTEGER,
  name TEXT NOT NULL,
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
);

-- Index spatiaux
CREATE INDEX IF NOT EXISTS idx_regions_geom
  ON regions_boundaries USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_departements_geom
  ON departements_boundaries USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_communes_geom
  ON communes_boundaries USING GIST (geometry);

-- Table des localités
CREATE TABLE IF NOT EXISTS localites_geo (
  id SERIAL PRIMARY KEY,
  geonameid INTEGER,
  name TEXT NOT NULL,
  commune_id INTEGER,
  departement_id INTEGER,
  region_id INTEGER,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  source TEXT DEFAULT 'sn_txt'
);

CREATE INDEX IF NOT EXISTS idx_localites_commune_id
  ON localites_geo (commune_id);

CREATE INDEX IF NOT EXISTS idx_localites_departement_id
  ON localites_geo (departement_id);

CREATE INDEX IF NOT EXISTS idx_localites_region_id
  ON localites_geo (region_id);

CREATE INDEX IF NOT EXISTS idx_localites_name
  ON localites_geo (name);

CREATE INDEX IF NOT EXISTS idx_localites_geonameid
  ON localites_geo (geonameid);

-- Index sur les clés de liaison
CREATE INDEX IF NOT EXISTS idx_regions_region_id
  ON regions_boundaries (region_id);

CREATE INDEX IF NOT EXISTS idx_departements_departement_id
  ON departements_boundaries (departement_id);

CREATE INDEX IF NOT EXISTS idx_departements_region_id
  ON departements_boundaries (region_id);

CREATE INDEX IF NOT EXISTS idx_communes_commune_id
  ON communes_boundaries (commune_id);

CREATE INDEX IF NOT EXISTS idx_communes_departement_id
  ON communes_boundaries (departement_id);
`;

async function initDatabase() {
  const client = await pool.connect();
  try {
    console.log('Initialisation de la base de données...');
    await client.query(initSQL);
    console.log('Tables et index créés avec succès.');
  } catch (err) {
    console.error('Erreur lors de l\'initialisation :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
