/**
 * migrate-tables.js
 *
 * Migration complète :
 *  1. Renomme regions_boundaries  → regions
 *             departements_boundaries → departements
 *             communes_boundaries     → communes
 *  2. Uniformise la colonne geometry → geometry(MultiPolygon, 4326)
 *     - localites : fusionne geom_polygon (Voronoï) dans geometry, convert en MultiPolygon
 *  3. Ajoute population INTEGER + densite DOUBLE PRECISION sur toutes les tables
 *  4. Recrée tous les index GIST + FK
 *  5. Supprime les colonnes obsolètes de localites (geom_point, geom_polygon)
 */

const pool = require('../database/connection');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─────────────────────────────────────────────────────────────
    // 1. RENOMMAGE DES TABLES (idempotent)
    // ─────────────────────────────────────────────────────────────
    console.log('=== 1. Renommage des tables ===');

    const renames = [
      ['regions_boundaries',    'regions'],
      ['departements_boundaries','departements'],
      ['communes_boundaries',    'communes'],
    ];

    for (const [oldName, newName] of renames) {
      const { rows } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      `, [oldName]);

      const { rows: alreadyExists } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      `, [newName]);

      if (rows.length > 0 && alreadyExists.length === 0) {
        await client.query(`ALTER TABLE ${oldName} RENAME TO ${newName}`);
        console.log(`  ✓ ${oldName} → ${newName}`);
      } else if (alreadyExists.length > 0) {
        console.log(`  ✓ ${newName} existe déjà`);
      } else {
        console.log(`  ⚠ Table ${oldName} introuvable, ignoré`);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. UNIFORMISATION DES COLONNES GÉOMÉTRIQUES
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 2. Uniformisation geometry(MultiPolygon, 4326) ===');

    // regions, departements, communes : geometry est déjà MultiPolygon — vérifier + recaster si besoin
    for (const tbl of ['regions', 'departements', 'communes']) {
      const { rows } = await client.query(`
        SELECT type FROM geometry_columns
        WHERE f_table_name = $1 AND f_geometry_column = 'geometry'
      `, [tbl]);

      if (rows.length === 0 || rows[0].type.toUpperCase() !== 'MULTIPOLYGON') {
        await client.query(`
          ALTER TABLE ${tbl}
            ALTER COLUMN geometry TYPE geometry(MultiPolygon,4326)
            USING ST_Multi(ST_SetSRID(geometry,4326))
        `);
        console.log(`  ✓ ${tbl}.geometry → MultiPolygon`);
      } else {
        console.log(`  ✓ ${tbl}.geometry déjà MultiPolygon`);
      }
    }

    // localites : ajouter colonne geometry(MultiPolygon,4326) depuis geom_polygon
    const { rows: locCols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'localites' AND column_name = 'geometry'
    `);

    if (locCols.length === 0) {
      console.log('  Ajout de localites.geometry depuis geom_polygon (Voronoï)...');
      await client.query(`
        ALTER TABLE localites
          ADD COLUMN geometry GEOMETRY(MultiPolygon, 4326)
      `);

      await client.query(`
        UPDATE localites
        SET geometry = ST_Multi(
          COALESCE(
            CASE WHEN GeometryType(geom_polygon) IN ('POLYGON','MULTIPOLYGON')
                 THEN geom_polygon ELSE NULL END,
            ST_Buffer(geom_point::geography, 50)::geometry
          )
        )
        WHERE geom_polygon IS NOT NULL OR geom_point IS NOT NULL
      `);

      const { rows: [stats] } = await client.query(`
        SELECT COUNT(*) FILTER (WHERE geometry IS NOT NULL) AS cnt FROM localites
      `);
      console.log(`  ✓ localites.geometry peuplée : ${stats.cnt} lignes`);
    } else {
      // S'assurer que c'est bien MultiPolygon
      const { rows: ltypes } = await client.query(`
        SELECT type FROM geometry_columns
        WHERE f_table_name = 'localites' AND f_geometry_column = 'geometry'
      `);
      if (ltypes.length > 0 && ltypes[0].type.toUpperCase() !== 'MULTIPOLYGON') {
        await client.query(`
          ALTER TABLE localites
            ALTER COLUMN geometry TYPE geometry(MultiPolygon,4326)
            USING ST_Multi(ST_SetSRID(geometry,4326))
        `);
        console.log('  ✓ localites.geometry converti en MultiPolygon');
      } else {
        console.log('  ✓ localites.geometry déjà présente');
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. RECALCUL superficie_km2 si manquant
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 3. superficie_km2 ===');

    for (const tbl of ['regions', 'departements', 'communes', 'localites']) {
      await client.query(`
        ALTER TABLE ${tbl}
          ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION
      `);
      const { rowCount } = await client.query(`
        UPDATE ${tbl}
        SET superficie_km2 = ST_Area(geometry::geography) / 1000000.0
        WHERE superficie_km2 IS NULL AND geometry IS NOT NULL
      `);
      if (rowCount > 0) console.log(`  ✓ ${tbl} : ${rowCount} superficies recalculées`);
      else console.log(`  ✓ ${tbl} : superficies déjà présentes`);
    }

    // ─────────────────────────────────────────────────────────────
    // 4. COLONNES population + densite
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 4. Colonnes population + densite ===');

    for (const tbl of ['regions', 'departements', 'communes', 'localites']) {
      await client.query(`
        ALTER TABLE ${tbl}
          ADD COLUMN IF NOT EXISTS population INTEGER,
          ADD COLUMN IF NOT EXISTS densite DOUBLE PRECISION
      `);
      console.log(`  ✓ ${tbl}.population + densite prêts`);
    }

    // ─────────────────────────────────────────────────────────────
    // 5. INDEX GIST + FK indexes
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 5. Index GIST ===');

    const indexes = [
      ['idx_regions_geom',      'regions',      'GIST', 'geometry'],
      ['idx_departements_geom', 'departements', 'GIST', 'geometry'],
      ['idx_communes_geom',     'communes',     'GIST', 'geometry'],
      ['idx_localites_geom',    'localites',    'GIST', 'geometry'],
      ['idx_regions_region_id',         'regions',      'BTREE', 'region_id'],
      ['idx_departements_region_id',    'departements', 'BTREE', 'region_id'],
      ['idx_departements_dept_id',      'departements', 'BTREE', 'departement_id'],
      ['idx_communes_departement_id',   'communes',     'BTREE', 'departement_id'],
      ['idx_communes_commune_id',       'communes',     'BTREE', 'commune_id'],
      ['idx_localites_commune_id',      'localites',    'BTREE', 'commune_id'],
      ['idx_localites_departement_id',  'localites',    'BTREE', 'departement_id'],
      ['idx_localites_region_id',       'localites',    'BTREE', 'region_id'],
      ['idx_localites_name',            'localites',    'BTREE', 'name'],
    ];

    for (const [idxName, tbl, method, col] of indexes) {
      await client.query(`
        CREATE INDEX IF NOT EXISTS ${idxName}
          ON ${tbl} USING ${method} (${col})
      `);
      console.log(`  ✓ ${idxName}`);
    }

    // ─────────────────────────────────────────────────────────────
    // 6. SUPPRESSION colonnes obsolètes de localites
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 6. Nettoyage colonnes obsolètes (localites) ===');

    for (const col of ['geom_point', 'geom_polygon']) {
      const { rows } = await client.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'localites' AND column_name = $1
      `, [col]);
      if (rows.length > 0) {
        await client.query(`ALTER TABLE localites DROP COLUMN ${col}`);
        console.log(`  ✓ localites.${col} supprimée`);
      } else {
        console.log(`  ✓ localites.${col} déjà absente`);
      }
    }

    await client.query('COMMIT');

    // ─────────────────────────────────────────────────────────────
    // RAPPORT FINAL
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== RAPPORT FINAL ===');

    for (const tbl of ['regions', 'departements', 'communes', 'localites']) {
      const { rows: [r] } = await client.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(geometry) AS with_geom,
          COUNT(superficie_km2) AS with_superficie
        FROM ${tbl}
      `);
      console.log(`  ${tbl.padEnd(15)} total=${r.total} geom=${r.with_geom} superficie=${r.with_superficie}`);
    }

    // Vérifier les types géom
    const { rows: geomTypes } = await client.query(`
      SELECT f_table_name, type
      FROM geometry_columns
      WHERE f_table_name IN ('regions','departements','communes','localites')
        AND f_geometry_column = 'geometry'
      ORDER BY f_table_name
    `);
    console.log('\n  Types géométriques :');
    for (const r of geomTypes) {
      console.log(`    ${r.f_table_name.padEnd(15)} → ${r.type}`);
    }

    console.log('\n✅ Migration terminée avec succès.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Erreur migration :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
