const pool = require('../database/connection');

const BASE_SELECT = `
  WITH region_geom AS (
    SELECT ST_Multi(ST_UnaryUnion(ST_Collect(geometry))) AS geom
    FROM regions
    WHERE geometry IS NOT NULL
  ),
  population_agg AS (
    SELECT SUM(population)::bigint AS population
    FROM localites
  )
  SELECT
    1 AS id,
    'Sénégal' AS name,
    CASE WHEN rg.geom IS NOT NULL THEN ST_Y(ST_Centroid(rg.geom)) ELSE NULL END AS lat,
    CASE WHEN rg.geom IS NOT NULL THEN ST_X(ST_Centroid(rg.geom)) ELSE NULL END AS lon,
    NULL::numeric AS elevation,
    CASE WHEN rg.geom IS NOT NULL THEN ST_Area(geography(rg.geom)) / 1000000.0 ELSE NULL END AS superficie_km2,
    pop.population AS population,
    CASE
      WHEN pop.population IS NOT NULL AND rg.geom IS NOT NULL
           AND (ST_Area(geography(rg.geom)) / 1000000.0) > 0
      THEN pop.population / (ST_Area(geography(rg.geom)) / 1000000.0)
      ELSE NULL
    END AS densite,
    rg.geom AS geometry
  FROM region_geom rg
  CROSS JOIN population_agg pop
`;

const SELECT_WITH_GEOJSON = `
  SELECT id, name, lat, lon, elevation,
         superficie_km2, population, densite,
         ST_AsGeoJSON(geometry)::json AS geometry
  FROM (
    ${BASE_SELECT}
  ) base
`;

const PROPERTIES_SQL = `json_build_object(
  'id',             id,
  'name',           name,
  'lat',            lat,
  'lon',            lon,
  'elevation',      elevation,
  'superficie_km2', superficie_km2,
  'population',     population,
  'densite',        densite
)`;

const Pays = {
  async findAll() {
    const result = await pool.query(SELECT_WITH_GEOJSON);
    return result.rows;
  },

  async findById() {
    const result = await pool.query(SELECT_WITH_GEOJSON);
    return result.rows[0] || null;
  },

  async findAsFeature() {
    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'Feature',
        'properties', ${PROPERTIES_SQL},
        'geometry', ST_AsGeoJSON(geometry)::json
      ) AS feature
      FROM (
        ${BASE_SELECT}
      ) base
    `);
    return result.rows[0]?.feature || null;
  },

  async findAllAsFeatureCollection() {
    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', ${PROPERTIES_SQL},
            'geometry', ST_AsGeoJSON(geometry)::json
          )
        ), '[]'::json)
      ) AS geojson
      FROM (
        ${BASE_SELECT}
      ) base
    `);
    return result.rows[0].geojson;
  },
};

module.exports = Pays;
