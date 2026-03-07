const pool = require('./connection');

// ─── Migration idempotente ──────────────────────────────────────────────────
// Ce script peut être exécuté plusieurs fois sans risque.
// Il ajoute les colonnes manquantes et crée les index nécessaires.

const MIGRATIONS = [
  // ── Extensions ────────────────────────────────────────────────────────────
  { label: 'Extension PostGIS',  sql: 'CREATE EXTENSION IF NOT EXISTS postgis' },
  { label: 'Extension pg_trgm',  sql: 'CREATE EXTENSION IF NOT EXISTS pg_trgm', optional: true },

  // ── Colonnes uniformes : pays ─────────────────────────────────────────────
  { label: 'pays.lat',            sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS lat            DOUBLE PRECISION" },
  { label: 'pays.lon',            sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS lon            DOUBLE PRECISION" },
  { label: 'pays.elevation',      sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS elevation      DOUBLE PRECISION" },
  { label: 'pays.geometry',       sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS geometry       geometry(MultiPolygon, 4326)" },
  { label: 'pays.superficie_km2', sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION" },
  { label: 'pays.population',     sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS population     BIGINT" },
  { label: 'pays.densite',        sql: "ALTER TABLE pays ADD COLUMN IF NOT EXISTS densite        DOUBLE PRECISION" },

  // ── Colonnes uniformes : regions ──────────────────────────────────────────
  { label: 'regions.code',           sql: "ALTER TABLE regions ADD COLUMN IF NOT EXISTS code           TEXT" },
  { label: 'regions.lat',            sql: "ALTER TABLE regions ADD COLUMN IF NOT EXISTS lat            DOUBLE PRECISION" },
  { label: 'regions.lon',            sql: "ALTER TABLE regions ADD COLUMN IF NOT EXISTS lon            DOUBLE PRECISION" },
  { label: 'regions.elevation',      sql: "ALTER TABLE regions ADD COLUMN IF NOT EXISTS elevation      DOUBLE PRECISION" },
  { label: 'regions.geometry',       sql: "ALTER TABLE regions ADD COLUMN IF NOT EXISTS geometry       geometry(MultiPolygon, 4326)" },
  { label: 'regions.superficie_km2', sql: "ALTER TABLE regions ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION" },
  { label: 'regions.population',     sql: "ALTER TABLE regions ADD COLUMN IF NOT EXISTS population     INTEGER" },
  { label: 'regions.densite',        sql: "ALTER TABLE regions ADD COLUMN IF NOT EXISTS densite        DOUBLE PRECISION" },

  // ── Colonnes uniformes : departements ─────────────────────────────────────
  { label: 'departements.region_id',      sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS region_id      INTEGER" },
  { label: 'departements.code',           sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS code           TEXT" },
  { label: 'departements.lat',            sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS lat            DOUBLE PRECISION" },
  { label: 'departements.lon',            sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS lon            DOUBLE PRECISION" },
  { label: 'departements.elevation',      sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS elevation      DOUBLE PRECISION" },
  { label: 'departements.geometry',       sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS geometry       geometry(MultiPolygon, 4326)" },
  { label: 'departements.superficie_km2', sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION" },
  { label: 'departements.population',     sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS population     INTEGER" },
  { label: 'departements.densite',        sql: "ALTER TABLE departements ADD COLUMN IF NOT EXISTS densite        DOUBLE PRECISION" },

  // ── Colonnes uniformes : communes ─────────────────────────────────────────
  { label: 'communes.region_id',      sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS region_id      INTEGER" },
  { label: 'communes.departement_id', sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS departement_id INTEGER" },
  { label: 'communes.lat',            sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS lat            DOUBLE PRECISION" },
  { label: 'communes.lon',            sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS lon            DOUBLE PRECISION" },
  { label: 'communes.elevation',      sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS elevation      DOUBLE PRECISION" },
  { label: 'communes.geometry',       sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS geometry       geometry(MultiPolygon, 4326)" },
  { label: 'communes.superficie_km2', sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION" },
  { label: 'communes.population',     sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS population     INTEGER" },
  { label: 'communes.densite',        sql: "ALTER TABLE communes ADD COLUMN IF NOT EXISTS densite        DOUBLE PRECISION" },

  // ── Colonnes uniformes : localites ────────────────────────────────────────
  { label: 'localites.commune_id',      sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS commune_id      INTEGER" },
  { label: 'localites.departement_id',  sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS departement_id  INTEGER" },
  { label: 'localites.region_id',       sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS region_id       INTEGER" },
  { label: 'localites.lat',             sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS lat             DOUBLE PRECISION" },
  { label: 'localites.lon',             sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS lon             DOUBLE PRECISION" },
  { label: 'localites.elevation',       sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS elevation       DOUBLE PRECISION" },
  { label: 'localites.geometry',        sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS geometry        geometry(MultiPolygon, 4326)" },
  { label: 'localites.superficie_km2',  sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS superficie_km2  DOUBLE PRECISION" },
  { label: 'localites.population',      sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS population      INTEGER" },
  { label: 'localites.densite',         sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS densite         DOUBLE PRECISION" },
  { label: 'localites.normalized_name', sql: "ALTER TABLE localites ADD COLUMN IF NOT EXISTS normalized_name TEXT" },

  // ── Index GIST (géométrie) ────────────────────────────────────────────────
  { label: 'idx pays geom',         sql: 'CREATE INDEX IF NOT EXISTS idx_pays_geom         ON pays         USING GIST (geometry)' },
  { label: 'idx regions geom',      sql: 'CREATE INDEX IF NOT EXISTS idx_regions_geom      ON regions      USING GIST (geometry)' },
  { label: 'idx departements geom', sql: 'CREATE INDEX IF NOT EXISTS idx_departements_geom ON departements USING GIST (geometry)' },
  { label: 'idx communes geom',     sql: 'CREATE INDEX IF NOT EXISTS idx_communes_geom     ON communes     USING GIST (geometry)' },
  { label: 'idx localites geom',    sql: 'CREATE INDEX IF NOT EXISTS idx_localites_geom    ON localites    USING GIST (geometry)' },

  // ── Index clés de liaison ─────────────────────────────────────────────────
  { label: 'idx dept→region',       sql: 'CREATE INDEX IF NOT EXISTS idx_departements_region_id   ON departements (region_id)' },
  { label: 'idx comm→dept',         sql: 'CREATE INDEX IF NOT EXISTS idx_communes_departement_id  ON communes     (departement_id)' },
  { label: 'idx comm→region',       sql: 'CREATE INDEX IF NOT EXISTS idx_communes_region_id       ON communes     (region_id)' },
  { label: 'idx loc→commune',       sql: 'CREATE INDEX IF NOT EXISTS idx_localites_commune_id     ON localites    (commune_id)' },
  { label: 'idx loc→dept',          sql: 'CREATE INDEX IF NOT EXISTS idx_localites_departement_id ON localites    (departement_id)' },
  { label: 'idx loc→region',        sql: 'CREATE INDEX IF NOT EXISTS idx_localites_region_id      ON localites    (region_id)' },
  { label: 'idx loc name',          sql: 'CREATE INDEX IF NOT EXISTS idx_localites_name           ON localites    (name)' },

  // ── Index GIN trigram (optionnel) ─────────────────────────────────────────
  { label: 'idx trgm localites', sql: 'CREATE INDEX IF NOT EXISTS idx_localites_trgm ON localites USING GIN (normalized_name gin_trgm_ops)', optional: true },
];

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Migration de la base de données...\n');

    let ok = 0, skipped = 0;
    for (const step of MIGRATIONS) {
      try {
        await client.query(step.sql);
        console.log('  ✓', step.label);
        ok++;
      } catch (err) {
        if (step.optional) {
          console.warn('  ⚠', step.label, '(optionnel) :', err.message);
          skipped++;
        } else {
          console.error('  ✗', step.label, ':', err.message);
          throw err;
        }
      }
    }

    console.log(`\nMigration terminée : ${ok} réussies, ${skipped} optionnelles ignorées.`);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
