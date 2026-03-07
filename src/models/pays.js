const pool = require('../database/connection');

const COLUMNS = `id, name, lat, lon, elevation,
       superficie_km2, population, densite,
       ST_AsGeoJSON(geometry)::json AS geometry`;

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
    const result = await pool.query(`SELECT ${COLUMNS} FROM pays LIMIT 1`);
    return result.rows;
  },

  async findById() {
    const result = await pool.query(`SELECT ${COLUMNS} FROM pays LIMIT 1`);
    return result.rows[0] || null;
  },

  async findAsFeature() {
    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'Feature',
        'properties', ${PROPERTIES_SQL},
        'geometry', ST_AsGeoJSON(geometry)::json
      ) AS feature
      FROM pays
      LIMIT 1
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
      FROM pays
    `);
    return result.rows[0].geojson;
  },
};

module.exports = Pays;
