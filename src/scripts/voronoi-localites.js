/**
 * Étape 4 : Génère les polygones Voronoï des localités + superficie_km2 + geom_point
 *
 * Pour chaque commune :
 *   1. Créer geom_point = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
 *   2. Générer polygones Voronoï : ST_VoronoiPolygons(ST_Collect(geom_point))
 *   3. Intersecter chaque polygone Voronoï avec le polygone de la commune
 *   4. Associer chaque polygone à la localité via ST_Contains
 *   5. Calculer superficie_km2 = ST_Area(geom_polygon::geography) / 1e6
 *
 * Traitement par commune pour éviter les croisements de frontières.
 */

const pool = require('../database/connection');

async function main() {
  const client = await pool.connect();

  try {
    // ─────────────────────────────────────────────
    // Préparer la structure
    // ─────────────────────────────────────────────
    console.log('=== Préparation des colonnes ===');

    await client.query(`
      ALTER TABLE localites
        ADD COLUMN IF NOT EXISTS geom_point   GEOMETRY(Point, 4326),
        ADD COLUMN IF NOT EXISTS geom_polygon GEOMETRY(Geometry, 4326),
        ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION
    `);
    console.log('  ✓ Colonnes geom_point, geom_polygon, superficie_km2 présentes');

    // ─────────────────────────────────────────────
    // Étape A : Créer geom_point depuis lat/lon
    // ─────────────────────────────────────────────
    console.log('\n=== Étape A : geom_point depuis lat/lon ===');

    await client.query(`
      UPDATE localites
      SET geom_point = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `);

    const { rows: [ptStats] } = await client.query(`
      SELECT COUNT(*) FILTER (WHERE geom_point IS NOT NULL) AS with_point FROM localites
    `);
    console.log(`  ✓ geom_point créés : ${ptStats.with_point}`);

    // Index GIST sur geom_point
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_localites_geom_point
        ON localites USING GIST (geom_point)
    `);
    console.log('  ✓ Index GIST idx_localites_geom_point créé');

    // ─────────────────────────────────────────────
    // Étape B : Voronoï par commune
    // ─────────────────────────────────────────────
    console.log('\n=== Étape B : Voronoï par commune ===');

    // Lister toutes les communes ayant au moins 1 localité
    const { rows: communes } = await client.query(`
      SELECT DISTINCT l.commune_id, c.geometry AS commune_geom
      FROM localites l
      JOIN communes_boundaries c ON c.id = l.commune_id
      WHERE l.geom_point IS NOT NULL AND c.geometry IS NOT NULL
      ORDER BY l.commune_id
    `);

    console.log(`  Communes à traiter : ${communes.length}`);

    let totalAssigned = 0;
    let communesSkipped = 0;

    for (let i = 0; i < communes.length; i++) {
      const { commune_id } = communes[i];

      // Localités de cette commune
      const { rows: locs } = await client.query(`
        SELECT id FROM localites
        WHERE commune_id = $1 AND geom_point IS NOT NULL
      `, [commune_id]);

      if (locs.length === 0) {
        communesSkipped++;
        continue;
      }

      if (locs.length === 1) {
        // Une seule localité : polygone = polygone de la commune entière
        await client.query(`
          UPDATE localites l
          SET geom_polygon = (
            SELECT ST_Multi(c.geometry)
            FROM communes_boundaries c
            WHERE c.id = $1
          )
          WHERE l.commune_id = $1 AND l.geom_point IS NOT NULL
        `, [commune_id]);
        totalAssigned += 1;
        continue;
      }

      // Plusieurs localités : générer les polygones Voronoï
      // intersectés avec le polygone de la commune
      try {
        await client.query(`
          WITH
          commune AS (
            SELECT geometry AS geom FROM communes_boundaries WHERE id = $1
          ),
          pts AS (
            SELECT id, geom_point FROM localites
            WHERE commune_id = $1 AND geom_point IS NOT NULL
          ),
          voronoi AS (
            SELECT (ST_Dump(
              ST_VoronoiPolygons(
                ST_Collect(pts.geom_point),
                0.0,
                (SELECT geom FROM commune)
              )
            )).geom AS vor_geom
            FROM pts
          ),
          clipped AS (
            SELECT
              ST_Intersection(v.vor_geom, c.geom) AS clipped_geom
            FROM voronoi v, commune c
            WHERE ST_IsValid(v.vor_geom) AND ST_IsValid(c.geom)
          )
          UPDATE localites l
          SET geom_polygon = (
            SELECT cl.clipped_geom
            FROM clipped cl
            WHERE ST_Contains(cl.clipped_geom, l.geom_point)
              OR ST_Distance(cl.clipped_geom, l.geom_point) < 0.00001
            ORDER BY ST_Distance(cl.clipped_geom, l.geom_point)
            LIMIT 1
          )
          WHERE l.commune_id = $1 AND l.geom_point IS NOT NULL
        `, [commune_id]);

        totalAssigned += locs.length;
      } catch (err) {
        // Fallback : assigner le polygone de la commune entière à chaque localité
        await client.query(`
          UPDATE localites l
          SET geom_polygon = (
            SELECT geometry FROM communes_boundaries WHERE id = $1
          )
          WHERE l.commune_id = $1 AND l.geom_point IS NOT NULL
        `, [commune_id]);
        totalAssigned += locs.length;
      }

      if ((i + 1) % 50 === 0 || i === communes.length - 1) {
        const pct = (((i + 1) / communes.length) * 100).toFixed(1);
        process.stdout.write(`\r  Communes traitées : ${i + 1}/${communes.length} (${pct}%)`);
      }
    }

    console.log('\n  ✓ Voronoï terminé');

    // Fallback : localités sans geom_polygon → point bufferisé
    await client.query(`
      UPDATE localites
      SET geom_polygon = ST_Buffer(geom_point::geography, 100)::geometry
      WHERE geom_polygon IS NULL AND geom_point IS NOT NULL
    `);

    // ─────────────────────────────────────────────
    // Étape C : Calculer superficie_km2
    // ─────────────────────────────────────────────
    console.log('\n=== Étape C : superficie_km2 ===');

    await client.query(`
      UPDATE localites
      SET superficie_km2 = ST_Area(geom_polygon::geography) / 1000000.0
      WHERE geom_polygon IS NOT NULL
    `);

    // ─────────────────────────────────────────────
    // Étape D : Index GIST sur geom_polygon
    // ─────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_localites_geom_polygon
        ON localites USING GIST (geom_polygon)
    `);
    console.log('  ✓ Index GIST idx_localites_geom_polygon créé');

    // ─────────────────────────────────────────────
    // Rapport final
    // ─────────────────────────────────────────────
    const { rows: [stats] } = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(geom_point) AS with_point,
        COUNT(geom_polygon) AS with_polygon,
        COUNT(superficie_km2) AS with_area,
        ROUND(MIN(superficie_km2)::numeric, 4) AS min_area,
        ROUND(MAX(superficie_km2)::numeric, 2) AS max_area,
        ROUND(AVG(superficie_km2)::numeric, 4) AS avg_area
      FROM localites
    `);

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║         RAPPORT voronoi-localites               ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Total localités              : ${String(stats.total).padStart(10)} ║`);
    console.log(`║  Avec geom_point              : ${String(stats.with_point).padStart(10)} ║`);
    console.log(`║  Avec geom_polygon            : ${String(stats.with_polygon).padStart(10)} ║`);
    console.log(`║  Avec superficie_km2          : ${String(stats.with_area).padStart(10)} ║`);
    console.log(`║  Superficie min (km2)         : ${String(stats.min_area).padStart(10)} ║`);
    console.log(`║  Superficie max (km2)         : ${String(stats.max_area).padStart(10)} ║`);
    console.log(`║  Superficie moy (km2)         : ${String(stats.avg_area).padStart(10)} ║`);
    console.log('╚══════════════════════════════════════════════════╝');

  } catch (err) {
    console.error('\nErreur :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
