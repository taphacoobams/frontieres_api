const pool = require('../database/connection');

const COLUMNS = `id, name, code, lat, lon, elevation,
       superficie_km2, population, densite,
       ST_AsGeoJSON(geometry)::json AS geometry`;

const PROPERTIES_SQL = `json_build_object(
  'id',             id,
  'name',           name,
  'code',           code,
  'lat',            lat,
  'lon',            lon,
  'elevation',      elevation,
  'superficie_km2', superficie_km2,
  'population',     population,
  'densite',        densite
)`;

const Region = {
  async findAll() {
    const result = await pool.query(`SELECT ${COLUMNS} FROM regions ORDER BY name`);
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(`SELECT ${COLUMNS} FROM regions WHERE id = $1`, [id]);
    return result.rows[0] || null;
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
        ORDER BY name), '[]'::json)
      ) AS geojson
      FROM regions
    `);
    return result.rows[0].geojson;
  },
};

module.exports = Region;
