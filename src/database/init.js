const pool = require('./connection');

// ─── Étapes d'initialisation ─────────────────────────────────────
// Chaque étape est isolée : une erreur sur une étape optionnelle
// ne bloque pas les suivantes.

const STEPS = [

  // ── 1. Extensions ──────────────────────────────────────────────
  {
    label: 'Activer PostGIS',
    sql: 'CREATE EXTENSION IF NOT EXISTS postgis'
  },
  {
    label: 'Activer pg_trgm',
    sql: 'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    optional: true
  },

  // ── 2. Création des tables (si elles n'existent pas) ───────────
  {
    label: 'Table regions',
    sql: `CREATE TABLE IF NOT EXISTS regions (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  code           TEXT,
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  elevation      DOUBLE PRECISION,
  geometry       geometry(MultiPolygon, 4326),
  superficie_km2 DOUBLE PRECISION,
  population     INTEGER,
  densite        DOUBLE PRECISION
)`
  },
  {
    label: 'Table departements',
    sql: `CREATE TABLE IF NOT EXISTS departements (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  region_id      INTEGER,
  code           TEXT,
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  elevation      DOUBLE PRECISION,
  geometry       geometry(MultiPolygon, 4326),
  superficie_km2 DOUBLE PRECISION,
  population     INTEGER,
  densite        DOUBLE PRECISION
)`
  },
  {
    label: 'Table communes',
    sql: `CREATE TABLE IF NOT EXISTS communes (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  region_id      INTEGER,
  departement_id INTEGER,
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  elevation      DOUBLE PRECISION,
  geometry       geometry(MultiPolygon, 4326),
  superficie_km2 DOUBLE PRECISION,
  population     INTEGER,
  densite        DOUBLE PRECISION
)`
  },
  {
    label: 'Table localites',
    sql: `CREATE TABLE IF NOT EXISTS localites (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  commune_id      INTEGER,
  departement_id  INTEGER,
  region_id       INTEGER,
  lat             DOUBLE PRECISION,
  lon             DOUBLE PRECISION,
  elevation       DOUBLE PRECISION,
  geometry        geometry(MultiPolygon, 4326),
  superficie_km2  DOUBLE PRECISION,
  population      INTEGER,
  densite         DOUBLE PRECISION,
  normalized_name TEXT
)`
  },

  // ── 2b. Table pays
  {
    label: 'Table pays',
    sql: `CREATE TABLE IF NOT EXISTS pays (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  geometry       geometry(MultiPolygon, 4326),
  superficie_km2 DOUBLE PRECISION,
  population     BIGINT,
  densite        DOUBLE PRECISION
)`
  },

  // ── 3. Migrations pour bases existantes ────────────────────────
  // ADD COLUMN IF NOT EXISTS garantit que les colonnes manquantes
  // sont ajoutées même si les tables existaient déjà.

  // regions
  { label: 'Migration regions.code',           sql: "ALTER TABLE regions       ADD COLUMN IF NOT EXISTS code           TEXT" },
  { label: 'Migration regions.lat',            sql: "ALTER TABLE regions       ADD COLUMN IF NOT EXISTS lat            DOUBLE PRECISION" },
  { label: 'Migration regions.lon',            sql: "ALTER TABLE regions       ADD COLUMN IF NOT EXISTS lon            DOUBLE PRECISION" },
  { label: 'Migration regions.elevation',      sql: "ALTER TABLE regions       ADD COLUMN IF NOT EXISTS elevation      DOUBLE PRECISION" },
  { label: 'Migration regions.geometry',       sql: "ALTER TABLE regions       ADD COLUMN IF NOT EXISTS geometry       geometry(MultiPolygon, 4326)" },
  { label: 'Migration regions.superficie_km2', sql: "ALTER TABLE regions       ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION" },
  { label: 'Migration regions.population',     sql: "ALTER TABLE regions       ADD COLUMN IF NOT EXISTS population     INTEGER" },
  { label: 'Migration regions.densite',        sql: "ALTER TABLE regions       ADD COLUMN IF NOT EXISTS densite        DOUBLE PRECISION" },

  // departements
  { label: 'Migration departements.region_id',      sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS region_id      INTEGER" },
  { label: 'Migration departements.code',           sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS code           TEXT" },
  { label: 'Migration departements.lat',            sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS lat            DOUBLE PRECISION" },
  { label: 'Migration departements.lon',            sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS lon            DOUBLE PRECISION" },
  { label: 'Migration departements.elevation',      sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS elevation      DOUBLE PRECISION" },
  { label: 'Migration departements.geometry',       sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS geometry       geometry(MultiPolygon, 4326)" },
  { label: 'Migration departements.superficie_km2', sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION" },
  { label: 'Migration departements.population',     sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS population     INTEGER" },
  { label: 'Migration departements.densite',        sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS densite        DOUBLE PRECISION" },

  // communes
  { label: 'Migration communes.region_id',      sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS region_id      INTEGER" },
  { label: 'Migration communes.departement_id', sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS departement_id INTEGER" },
  { label: 'Migration communes.lat',            sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS lat            DOUBLE PRECISION" },
  { label: 'Migration communes.lon',            sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS lon            DOUBLE PRECISION" },
  { label: 'Migration communes.elevation',      sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS elevation      DOUBLE PRECISION" },
  { label: 'Migration communes.geometry',       sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS geometry       geometry(MultiPolygon, 4326)" },
  { label: 'Migration communes.superficie_km2', sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION" },
  { label: 'Migration communes.population',     sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS population     INTEGER" },
  { label: 'Migration communes.densite',        sql: "ALTER TABLE communes      ADD COLUMN IF NOT EXISTS densite        DOUBLE PRECISION" },

  // localites
  { label: 'Migration localites.geometry',        sql: "ALTER TABLE localites     ADD COLUMN IF NOT EXISTS geometry        geometry(MultiPolygon, 4326)" },
  { label: 'Migration localites.lat',             sql: "ALTER TABLE localites     ADD COLUMN IF NOT EXISTS lat             DOUBLE PRECISION" },
  { label: 'Migration localites.lon',             sql: "ALTER TABLE localites     ADD COLUMN IF NOT EXISTS lon             DOUBLE PRECISION" },
  { label: 'Migration localites.elevation',       sql: "ALTER TABLE localites     ADD COLUMN IF NOT EXISTS elevation       DOUBLE PRECISION" },
  { label: 'Migration localites.superficie_km2',  sql: "ALTER TABLE localites     ADD COLUMN IF NOT EXISTS superficie_km2  DOUBLE PRECISION" },
  { label: 'Migration localites.population',      sql: "ALTER TABLE localites     ADD COLUMN IF NOT EXISTS population      INTEGER" },
  { label: 'Migration localites.densite',         sql: "ALTER TABLE localites     ADD COLUMN IF NOT EXISTS densite         DOUBLE PRECISION" },
  { label: 'Migration localites.normalized_name', sql: "ALTER TABLE localites     ADD COLUMN IF NOT EXISTS normalized_name TEXT" },

  // pays
  { label: 'Migration pays.geometry',       sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS geometry       geometry(MultiPolygon, 4326)" },
  { label: 'Migration pays.superficie_km2', sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION" },
  { label: 'Migration pays.population',     sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS population     BIGINT" },
  { label: 'Migration pays.densite',        sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS densite        DOUBLE PRECISION" },

  // ── 4. Index spatiaux GIST ─────────────────────────────────────
  { label: 'Index GIST pays',         sql: 'CREATE INDEX IF NOT EXISTS idx_pays_geom         ON pays         USING GIST (geometry)' },
  { label: 'Index GIST regions',      sql: 'CREATE INDEX IF NOT EXISTS idx_regions_geom      ON regions      USING GIST (geometry)' },
  { label: 'Index GIST departements', sql: 'CREATE INDEX IF NOT EXISTS idx_departements_geom ON departements USING GIST (geometry)' },
  { label: 'Index GIST communes',     sql: 'CREATE INDEX IF NOT EXISTS idx_communes_geom     ON communes     USING GIST (geometry)' },
  { label: 'Index GIST localites',    sql: 'CREATE INDEX IF NOT EXISTS idx_localites_geom    ON localites    USING GIST (geometry)' },

  // ── 5. Index sur clés de liaison ───────────────────────────────
  { label: 'Index departements.region_id',      sql: 'CREATE INDEX IF NOT EXISTS idx_departements_region_id    ON departements (region_id)' },
  { label: 'Index communes.departement_id',     sql: 'CREATE INDEX IF NOT EXISTS idx_communes_departement_id   ON communes     (departement_id)' },
  { label: 'Index communes.region_id',          sql: 'CREATE INDEX IF NOT EXISTS idx_communes_region_id        ON communes     (region_id)' },
  { label: 'Index localites.commune_id',        sql: 'CREATE INDEX IF NOT EXISTS idx_localites_commune_id      ON localites    (commune_id)' },
  { label: 'Index localites.departement_id',    sql: 'CREATE INDEX IF NOT EXISTS idx_localites_departement_id  ON localites    (departement_id)' },
  { label: 'Index localites.region_id',         sql: 'CREATE INDEX IF NOT EXISTS idx_localites_region_id       ON localites    (region_id)' },
  { label: 'Index localites.name',              sql: 'CREATE INDEX IF NOT EXISTS idx_localites_name            ON localites    (name)' },

  // ── 6. Index GIN pour recherche floue (optionnel) ──────────────
  {
    label: 'Index GIN trgm localites',
    sql: 'CREATE INDEX IF NOT EXISTS idx_localites_trgm ON localites USING GIN (normalized_name gin_trgm_ops)',
    optional: true
  },
];

// ─── Exécution ───────────────────────────────────────────────────

async function initDatabase() {
  const client = await pool.connect();
  try {
    console.log('Initialisation de la base de données...\n');

    for (const step of STEPS) {
      try {
        await client.query(step.sql);
        console.log('  ✓', step.label);
      } catch (err) {
        if (step.optional) {
          console.warn('  ⚠ (optionnel)', step.label, ':', err.message);
        } else {
          console.error('  ✗', step.label, ':', err.message);
          throw err;
        }
      }
    }

    console.log('\nBase initialisée avec succès.');
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
