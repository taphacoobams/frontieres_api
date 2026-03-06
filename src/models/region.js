const pool = require('../database/connection');

const Region = {
  async findAll() {
    const result = await pool.query(`
      SELECT id, region_id, name, lat, lon,
             superficie_km2, population, densite,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM regions
      ORDER BY name
    `);
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(`
      SELECT id, region_id, name, lat, lon,
             superficie_km2, population, densite,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM regions
      WHERE id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  async findAllAsFeatureCollection() {
    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id',            id,
              'region_id',     region_id,
              'name',          name,
              'lat',           lat,
              'lon',           lon,
              'superficie_km2', superficie_km2,
              'population',    population,
              'densite',       densite
            ),
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
