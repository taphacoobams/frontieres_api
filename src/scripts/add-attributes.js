/**
 * Étape 3 : Ajoute lat, lon, superficie_km2 sur regions, departements, communes
 *
 * - Régions    : area_sqkm depuis admin1.geojson OCHA + ST_Centroid
 * - Départements : déjà fait dans update-departements.js, recalcul fallback
 * - Communes   : ST_Centroid(geometry) + ST_Area(geometry::geography)/1e6
 */

const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const ADMIN1_PATH = path.join(__dirname, '../../sen_admin_boundaries.geojson/sen_admin1.geojson');

function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function main() {
  const client = await pool.connect();

  try {
    // ─────────────────────────────────────────────
    // RÉGIONS
    // ─────────────────────────────────────────────
    console.log('=== RÉGIONS ===');

    await client.query(`
      ALTER TABLE regions_boundaries
        ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION
    `);
    console.log('  ✓ Colonnes lat/lon/superficie_km2 présentes');

    const admin1 = JSON.parse(fs.readFileSync(ADMIN1_PATH, 'utf8'));
    const ochaRegions = new Map();
    for (const f of admin1.features) {
      const p = f.properties;
      ochaRegions.set(normalizeName(p.adm1_name), p);
    }

    const { rows: regions } = await client.query(
      'SELECT id, name FROM regions_boundaries ORDER BY id'
    );

    let rUpdated = 0;
    await client.query('BEGIN');
    for (const r of regions) {
      const props = ochaRegions.get(normalizeName(r.name));
      if (props) {
        await client.query(`
          UPDATE regions_boundaries
          SET lat = $1, lon = $2, superficie_km2 = $3
          WHERE id = $4
        `, [props.center_lat, props.center_lon, props.area_sqkm, r.id]);
        rUpdated++;
      }
    }
    await client.query('COMMIT');

    // Fallback centroïde pour les non-matchées
    await client.query(`
      UPDATE regions_boundaries
      SET
        lat = ST_Y(ST_Centroid(geometry)),
        lon = ST_X(ST_Centroid(geometry)),
        superficie_km2 = ST_Area(geometry::geography) / 1000000.0
      WHERE lat IS NULL OR lon IS NULL OR superficie_km2 IS NULL
    `);

    console.log(`  ✓ Régions mises à jour : ${rUpdated}/${regions.length}`);

    // ─────────────────────────────────────────────
    // DÉPARTEMENTS (recalcul fallback si manquant)
    // ─────────────────────────────────────────────
    console.log('\n=== DÉPARTEMENTS ===');

    await client.query(`
      ALTER TABLE departements_boundaries
        ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION
    `);

    await client.query(`
      UPDATE departements_boundaries
      SET
        lat = ST_Y(ST_Centroid(geometry)),
        lon = ST_X(ST_Centroid(geometry))
      WHERE lat IS NULL OR lon IS NULL
    `);
    await client.query(`
      UPDATE departements_boundaries
      SET superficie_km2 = ST_Area(geometry::geography) / 1000000.0
      WHERE superficie_km2 IS NULL
    `);

    const { rows: dStats } = await client.query(`
      SELECT COUNT(*) FILTER (WHERE lat IS NOT NULL) AS with_coords,
             COUNT(*) FILTER (WHERE superficie_km2 IS NOT NULL) AS with_area
      FROM departements_boundaries
    `);
    console.log(`  ✓ Avec lat/lon : ${dStats[0].with_coords} | Avec superficie : ${dStats[0].with_area}`);

    // ─────────────────────────────────────────────
    // COMMUNES
    // ─────────────────────────────────────────────
    console.log('\n=== COMMUNES ===');

    await client.query(`
      ALTER TABLE communes_boundaries
        ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION
    `);
    console.log('  ✓ Colonnes lat/lon/superficie_km2 présentes');

    // Recalculer centroïdes et superficies pour toutes les communes
    await client.query(`
      UPDATE communes_boundaries
      SET
        lat = ST_Y(ST_Centroid(geometry)),
        lon = ST_X(ST_Centroid(geometry)),
        superficie_km2 = ST_Area(geometry::geography) / 1000000.0
    `);

    const { rows: cStats } = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(lat) AS with_coords,
        COUNT(superficie_km2) AS with_area,
        ROUND(MIN(superficie_km2)::numeric, 2) AS min_area,
        ROUND(MAX(superficie_km2)::numeric, 2) AS max_area,
        ROUND(AVG(superficie_km2)::numeric, 2) AS avg_area
      FROM communes_boundaries
    `);
    const cs = cStats[0];
    console.log(`  ✓ Communes : ${cs.total} | Avec lat/lon : ${cs.with_coords} | Avec superficie : ${cs.with_area}`);
    console.log(`  ✓ Superficie : min=${cs.min_area} km² | max=${cs.max_area} km² | moy=${cs.avg_area} km²`);

    // ─────────────────────────────────────────────
    // RAPPORT FINAL
    // ─────────────────────────────────────────────
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║           RAPPORT add-attributes                ║');
    console.log('╠══════════════════════════════════════════════════╣');

    for (const [label, table] of [
      ['Régions', 'regions_boundaries'],
      ['Départements', 'departements_boundaries'],
      ['Communes', 'communes_boundaries'],
    ]) {
      const { rows: rs } = await client.query(`
        SELECT COUNT(*) AS total,
               COUNT(lat) AS coords,
               COUNT(superficie_km2) AS area
        FROM ${table}
      `);
      const r = rs[0];
      console.log(`║  ${label.padEnd(14)} total=${String(r.total).padStart(3)}  lat/lon=${String(r.coords).padStart(3)}  superficie=${String(r.area).padStart(3)} ║`);
    }
    console.log('╚══════════════════════════════════════════════════╝');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nErreur :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
