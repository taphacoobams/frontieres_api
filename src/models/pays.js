const pool = require('../database/connection');

const BASE_SELECT = `
  WITH region_geom AS (
    SELECT ST_Multi(ST_UnaryUnion(ST_Collect(geometry))) AS geom
    FROM regions
    WHERE geometry IS NOT NULL
  ),
  pays_one AS (
    SELECT * FROM pays LIMIT 1
  )
  SELECT
    COALESCE(p.id, 1) AS id,
    COALESCE(p.name, 'Sénégal') AS name,
    COALESCE(p.lat, ST_Y(ST_Centroid(COALESCE(p.geometry, rg.geom)))) AS lat,
    COALESCE(p.lon, ST_X(ST_Centroid(COALESCE(p.geometry, rg.geom)))) AS lon,
    p.elevation AS elevation,
    COALESCE(
      p.superficie_km2,
      CASE
        WHEN COALESCE(p.geometry, rg.geom) IS NOT NULL
        THEN ST_Area(geography(COALESCE(p.geometry, rg.geom))) / 1000000.0
        ELSE NULL
      END
    ) AS superficie_km2,
    p.population AS population,
    COALESCE(
      p.densite,
      CASE
        WHEN p.population IS NOT NULL AND COALESCE(p.superficie_km2,
          CASE
            WHEN COALESCE(p.geometry, rg.geom) IS NOT NULL
            THEN ST_Area(geography(COALESCE(p.geometry, rg.geom))) / 1000000.0
            ELSE NULL
          END
        ) > 0
        THEN p.population / COALESCE(
          p.superficie_km2,
          ST_Area(geography(COALESCE(p.geometry, rg.geom))) / 1000000.0
        )
        ELSE NULL
      END
    ) AS densite,
    COALESCE(p.geometry, rg.geom) AS geometry
  FROM region_geom rg
  LEFT JOIN pays_one p ON TRUE
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
