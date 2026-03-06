const pool = require('./connection');

const initSQL = `
-- Activer PostGIS + unaccent
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ───────────────────────────────────────────────
-- Table des régions
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regions (
  id             SERIAL PRIMARY KEY,
  region_id      INTEGER,
  name           TEXT NOT NULL,
  geometry       GEOMETRY(MultiPolygon, 4326),
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  superficie_km2 DOUBLE PRECISION,
  population     INTEGER,
  densite        DOUBLE PRECISION
);

-- ───────────────────────────────────────────────
-- Table des départements
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departements (
  id               SERIAL PRIMARY KEY,
  departement_id   INTEGER,
  region_id        INTEGER,
  name             TEXT NOT NULL,
  geometry         GEOMETRY(MultiPolygon, 4326),
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  superficie_km2   DOUBLE PRECISION,
  population       INTEGER,
  densite          DOUBLE PRECISION
);

-- ───────────────────────────────────────────────
-- Table des communes
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communes (
  id               SERIAL PRIMARY KEY,
  commune_id       INTEGER,
  departement_id   INTEGER,
  name             TEXT NOT NULL,
  geometry         GEOMETRY(MultiPolygon, 4326),
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  superficie_km2   DOUBLE PRECISION,
  population       INTEGER,
  densite          DOUBLE PRECISION
);

-- ───────────────────────────────────────────────
-- Table des localités
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS localites (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  commune_id       INTEGER,
  departement_id   INTEGER,
  region_id        INTEGER,
  latitude         DOUBLE PRECISION,
  longitude        DOUBLE PRECISION,
  source           TEXT,
  elevation        INTEGER,
  geometry         GEOMETRY(MultiPolygon, 4326),
  superficie_km2   DOUBLE PRECISION,
  population       INTEGER,
  densite          DOUBLE PRECISION
);

-- ───────────────────────────────────────────────
-- Index spatiaux GIST
-- ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_regions_geom
  ON regions USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_departements_geom
  ON departements USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_communes_geom
  ON communes USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_localites_geom
  ON localites USING GIST (geometry);

-- ───────────────────────────────────────────────
-- Index sur les clés de liaison
-- ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_regions_region_id
  ON regions (region_id);

CREATE INDEX IF NOT EXISTS idx_departements_region_id
  ON departements (region_id);

CREATE INDEX IF NOT EXISTS idx_departements_dept_id
  ON departements (departement_id);

CREATE INDEX IF NOT EXISTS idx_communes_departement_id
  ON communes (departement_id);

CREATE INDEX IF NOT EXISTS idx_communes_commune_id
  ON communes (commune_id);

CREATE INDEX IF NOT EXISTS idx_localites_commune_id
  ON localites (commune_id);

CREATE INDEX IF NOT EXISTS idx_localites_departement_id
  ON localites (departement_id);

CREATE INDEX IF NOT EXISTS idx_localites_region_id
  ON localites (region_id);

CREATE INDEX IF NOT EXISTS idx_localites_name
  ON localites (name);
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
