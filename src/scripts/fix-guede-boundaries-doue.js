require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const FRONTIERE_FILE = path.join(__dirname, '../data/frontiere.geojson');
const STATION_LON = -14.7644642;
const STATION_LAT = 16.5450742;

function stripAccents(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normName(s) {
  return stripAccents(String(s || '')).toLowerCase().trim();
}

function forEachCoord(geometry, cb) {
  if (!geometry || !geometry.type || !geometry.coordinates) return;
  if (geometry.type === 'LineString') {
    for (const pt of geometry.coordinates) cb(pt);
    return;
  }
  if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) {
      for (const pt of line) cb(pt);
    }
  }
}

function squaredDistance(aLon, aLat, bLon, bLat) {
  const dx = aLon - bLon;
  const dy = aLat - bLat;
  return dx * dx + dy * dy;
}

function pickClosestDoueFeature(geojson, stationLon, stationLat) {
  if (!geojson || !Array.isArray(geojson.features)) return null;

  const candidates = geojson.features.filter((f) => {
    const p = f && f.properties ? f.properties : {};
    const g = f ? f.geometry : null;
    const nameIsDoue = normName(p.name) === 'doue';
    const riverLike = normName(p.waterway) === 'river';
    const lineType = g && (g.type === 'LineString' || g.type === 'MultiLineString');
    return lineType && (nameIsDoue || riverLike);
  });

  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const f of candidates) {
    let localBest = Number.POSITIVE_INFINITY;
    forEachCoord(f.geometry, (pt) => {
      if (!Array.isArray(pt) || pt.length < 2) return;
      const d2 = squaredDistance(stationLon, stationLat, Number(pt[0]), Number(pt[1]));
      if (d2 < localBest) localBest = d2;
    });

    if (localBest < bestDist) {
      bestDist = localBest;
      best = f;
    }
  }

  return best;
}

async function run() {
  const client = await pool.connect();

  try {
    let doueGeomJson = null;
    if (fs.existsSync(FRONTIERE_FILE)) {
      const geojson = JSON.parse(fs.readFileSync(FRONTIERE_FILE, 'utf8'));
      const doue = pickClosestDoueFeature(geojson, STATION_LON, STATION_LAT);
      if (doue && doue.geometry) {
        doueGeomJson = JSON.stringify(doue.geometry);
        console.log('Doue trouve dans frontiere.geojson (contrainte nord activee).');
      } else {
        console.log('Doue non trouve, fallback sur limite nord 3km.');
      }
    } else {
      console.log('frontiere.geojson absent, fallback sur limite nord 3km.');
    }

    const before = await client.query(`
      SELECT id, name,
             round((ST_Area(geometry::geography)/1000000.0)::numeric, 4) AS area_km2,
             ST_AsText(ST_PointOnSurface(geometry)) AS point_on_surface,
             ST_IsValid(geometry) AS valid
      FROM communes
      WHERE translate(lower(name), 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc') IN ('guede chantier', 'guede village')
      ORDER BY name
    `);

    console.log('--- AVANT ---');
    console.table(before.rows);

    await client.query('BEGIN');

    await client.query(
      `
      WITH
      params AS (
        SELECT
          $1::double precision AS station_lon,
          $2::double precision AS station_lat,
          3000::double precision AS dist_east_m,
          3000::double precision AS dist_west_m,
          3000::double precision AS dist_south_m,
          3000::double precision AS dist_north_m,
          $3::text AS doue_geojson
      ),
      ids AS (
        SELECT
          MAX(CASE WHEN translate(lower(name), 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc') = 'guede chantier' THEN id END) AS chantier_id,
          MAX(CASE WHEN translate(lower(name), 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc') = 'guede village' THEN id END) AS village_id
        FROM communes
      ),
      base AS (
        SELECT
          i.chantier_id,
          i.village_id,
          ST_SetSRID(ST_MakePoint(p.station_lon, p.station_lat), 4326) AS station_pt,
          CASE
            WHEN p.doue_geojson IS NULL THEN NULL
            ELSE ST_SetSRID(ST_GeomFromGeoJSON(p.doue_geojson), 4326)
          END AS doue_geom
        FROM params p
        CROSS JOIN ids i
      ),
      dirs AS (
        SELECT
          chantier_id,
          village_id,
          station_pt,
          doue_geom,
          ST_Project(station_pt::geography, 3000, radians(270))::geometry AS pt_w,
          ST_Project(station_pt::geography, 3000, radians(90))::geometry AS pt_e,
          ST_Project(station_pt::geography, 3000, radians(180))::geometry AS pt_s,
          ST_Project(station_pt::geography, 3000, radians(0))::geometry AS pt_n
        FROM base
      ),
      north_limit AS (
        SELECT
          chantier_id,
          village_id,
          pt_w,
          pt_e,
          pt_s,
          pt_n,
          CASE
            WHEN doue_geom IS NULL THEN ST_Y(pt_n)
            ELSE ST_Y(
              ST_Project(
                ST_ClosestPoint(doue_geom, station_pt)::geography,
                100,
                radians(180)
              )::geometry
            )
          END AS north_lat
        FROM dirs
      ),
      box AS (
        SELECT
          chantier_id,
          village_id,
          ST_MakeEnvelope(
            LEAST(ST_X(pt_w), ST_X(pt_e)),
            ST_Y(pt_s),
            GREATEST(ST_X(pt_w), ST_X(pt_e)),
            LEAST(ST_Y(pt_n), north_lat),
            4326
          ) AS decree_box
        FROM north_limit
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
      `,
      [STATION_LON, STATION_LAT, doueGeomJson]
    );

    await client.query('COMMIT');

    const after = await client.query(`
      SELECT id, name,
             round((ST_Area(geometry::geography)/1000000.0)::numeric, 4) AS area_km2,
             ST_AsText(ST_PointOnSurface(geometry)) AS point_on_surface,
             ST_IsValid(geometry) AS valid
      FROM communes
      WHERE translate(lower(name), 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc') IN ('guede chantier', 'guede village')
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
