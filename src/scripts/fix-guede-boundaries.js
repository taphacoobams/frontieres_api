require('dotenv').config();
const pool = require('../database/connection');

async function run() {
  const client = await pool.connect();

  try {
    const before = await client.query(`
      SELECT id, name,
             round((ST_Area(geometry::geography)/1000000.0)::numeric, 4) AS area_km2,
             ST_AsText(ST_PointOnSurface(geometry)) AS point_on_surface,
             ST_IsValid(geometry) AS valid
      FROM communes
      WHERE lower(name) IN (
        lower('Guede Chantier'),
        lower('Guede Village'),
        lower('Gued\u00e9 Chantier'),
        lower('Gued\u00e9 Village')
      )
      ORDER BY name
    `);

    console.log('--- AVANT ---');
    console.table(before.rows);

    await client.query('BEGIN');

    await client.query(`
      WITH
      params AS (
        SELECT
          -14.7644642::double precision AS station_lon,
          16.5450742::double precision AS station_lat,
          3000::double precision AS dist_east_m,
          3000::double precision AS dist_west_m,
          3000::double precision AS dist_south_m,
          3000::double precision AS dist_north_m
      ),
      ids AS (
        SELECT
          MAX(CASE WHEN lower(name) IN (lower('Guede Chantier'), lower('Gued\u00e9 Chantier')) THEN id END) AS chantier_id,
          MAX(CASE WHEN lower(name) IN (lower('Guede Village'),  lower('Gued\u00e9 Village'))  THEN id END) AS village_id
        FROM communes
      ),
      base AS (
        SELECT
          i.chantier_id,
          i.village_id,
          ST_SetSRID(ST_MakePoint(p.station_lon, p.station_lat), 4326) AS station_pt
        FROM params p
        CROSS JOIN ids i
      ),
      dirs AS (
        SELECT
          chantier_id,
          village_id,
          station_pt,
          ST_Project(station_pt::geography, (SELECT dist_west_m  FROM params), radians(270))::geometry AS pt_w,
          ST_Project(station_pt::geography, (SELECT dist_east_m  FROM params), radians(90))::geometry AS pt_e,
          ST_Project(station_pt::geography, (SELECT dist_south_m FROM params), radians(180))::geometry AS pt_s,
          ST_Project(station_pt::geography, (SELECT dist_north_m FROM params), radians(0))::geometry AS pt_n
        FROM base
      ),
      box AS (
        SELECT
          chantier_id,
          village_id,
          ST_MakeEnvelope(
            LEAST(ST_X(pt_w), ST_X(pt_e)),
            LEAST(ST_Y(pt_s), ST_Y(pt_n)),
            GREATEST(ST_X(pt_w), ST_X(pt_e)),
            GREATEST(ST_Y(pt_s), ST_Y(pt_n)),
            4326
          ) AS decree_box
        FROM dirs
      ),
      current_pair AS (
        SELECT
          b.chantier_id,
          b.village_id,
          ST_UnaryUnion(ST_Collect(c.geometry)) AS pair_union
        FROM box b
        JOIN communes c ON c.id IN (b.chantier_id, b.village_id)
        GROUP BY b.chantier_id, b.village_id
      ),
      new_geoms AS (
        SELECT
          cp.chantier_id,
          cp.village_id,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(cp.pair_union, b.decree_box)), 3)) AS new_chantier,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference(cp.pair_union, ST_Intersection(cp.pair_union, b.decree_box))), 3)) AS new_village
        FROM current_pair cp
        JOIN box b ON b.chantier_id = cp.chantier_id AND b.village_id = cp.village_id
      )
      UPDATE communes c
      SET geometry = CASE
        WHEN c.id = n.chantier_id THEN n.new_chantier
        WHEN c.id = n.village_id THEN n.new_village
        ELSE c.geometry
      END
      FROM new_geoms n
      WHERE c.id IN (n.chantier_id, n.village_id)
        AND (
          (c.id = n.chantier_id AND NOT ST_IsEmpty(n.new_chantier))
          OR
          (c.id = n.village_id AND NOT ST_IsEmpty(n.new_village))
        )
    `);

    await client.query('COMMIT');

    const after = await client.query(`
      SELECT id, name,
             round((ST_Area(geometry::geography)/1000000.0)::numeric, 4) AS area_km2,
             ST_AsText(ST_PointOnSurface(geometry)) AS point_on_surface,
             ST_IsValid(geometry) AS valid
      FROM communes
      WHERE lower(name) IN (
        lower('Guede Chantier'),
        lower('Guede Village'),
        lower('Gued\u00e9 Chantier'),
        lower('Gued\u00e9 Village')
      )
      ORDER BY name
    `);

    console.log('--- APRES ---');
    console.table(after.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
