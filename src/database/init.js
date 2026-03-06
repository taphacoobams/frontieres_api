const pool = require('./connection');

// Chaque étape est isolée pour éviter qu'une erreur sur une extension
// optionnelle bloque la création des tables.
const STEPS = [
  // 1. Extensions
  {
    label: 'Activer PostGIS',
    sql: 'CREATE EXTENSION IF NOT EXISTS postgis'
  },
  {
    label: 'Activer pg_trgm (optionnel)',
    sql: 'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    optional: true
  },

  // 2. Tables
  {
    label: 'Table regions',
    sql: `CREATE TABLE IF NOT EXISTS regions (
  id             SERIAL PRIMARY KEY,
  region_id      INTEGER,
  name           TEXT NOT NULL,
  geometry       GEOMETRY(MultiPolygon, 4326),
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  superficie_km2 DOUBLE PRECISION,
  population     INTEGER,
  densite        DOUBLE PRECISION
)`
  },
  {
    label: 'Table departements',
    sql: `CREATE TABLE IF NOT EXISTS departements (
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
)`
  },
  {
    label: 'Table communes',
    sql: `CREATE TABLE IF NOT EXISTS communes (
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
)`
  },
  {
    label: 'Table localites',
    sql: `CREATE TABLE IF NOT EXISTS localites (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  normalized_name  TEXT,
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
)`
  },

  // 3. Index spatiaux GIST
  { label: 'Index GIST regions',      sql: 'CREATE INDEX IF NOT EXISTS idx_regions_geom     ON regions     USING GIST (geometry)' },
  { label: 'Index GIST departements', sql: 'CREATE INDEX IF NOT EXISTS idx_departements_geom ON departements USING GIST (geometry)' },
  { label: 'Index GIST communes',     sql: 'CREATE INDEX IF NOT EXISTS idx_communes_geom    ON communes    USING GIST (geometry)' },
  { label: 'Index GIST localites',    sql: 'CREATE INDEX IF NOT EXISTS idx_localites_geom   ON localites   USING GIST (geometry)' },

  // 4. Index sur clés de liaison
  { label: 'Index regions.region_id',         sql: 'CREATE INDEX IF NOT EXISTS idx_regions_region_id       ON regions      (region_id)' },
  { label: 'Index departements.region_id',    sql: 'CREATE INDEX IF NOT EXISTS idx_departements_region_id ON departements (region_id)' },
  { label: 'Index departements.dept_id',      sql: 'CREATE INDEX IF NOT EXISTS idx_departements_dept_id   ON departements (departement_id)' },
  { label: 'Index communes.departement_id',   sql: 'CREATE INDEX IF NOT EXISTS idx_communes_departement_id ON communes    (departement_id)' },
  { label: 'Index communes.commune_id',       sql: 'CREATE INDEX IF NOT EXISTS idx_communes_commune_id    ON communes     (commune_id)' },
  { label: 'Index localites.commune_id',      sql: 'CREATE INDEX IF NOT EXISTS idx_localites_commune_id   ON localites    (commune_id)' },
  { label: 'Index localites.departement_id',  sql: 'CREATE INDEX IF NOT EXISTS idx_localites_departement_id ON localites (departement_id)' },
  { label: 'Index localites.region_id',       sql: 'CREATE INDEX IF NOT EXISTS idx_localites_region_id    ON localites    (region_id)' },
  { label: 'Index localites.name',            sql: 'CREATE INDEX IF NOT EXISTS idx_localites_name         ON localites    (name)' },

  // 5. Index GIN pour recherche floue (dépend de pg_trgm)
  {
    label: 'Index GIN trgm localites (optionnel)',
    sql: 'CREATE INDEX IF NOT EXISTS idx_localites_trgm ON localites USING GIN (normalized_name gin_trgm_ops)',
    optional: true
  },
];

async function initDatabase() {
  const client = await pool.connect();
  try {
    console.log('Initialisation de la base de données...');
    for (const step of STEPS) {
      try {
        await client.query(step.sql);
        console.log('  ✓', step.label);
      } catch (err) {
        if (step.optional) {
          console.warn('  ⚠ (optionnel) ', step.label, ':', err.message);
        } else {
          console.error('  ✗', step.label, ':', err.message);
          throw err;
        }
      }
    }
    console.log('Tables et index créés avec succès.');
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
