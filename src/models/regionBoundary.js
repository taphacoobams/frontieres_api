const pool = require('../database/connection');

const RegionBoundary = {
  async findAll() {
    const result = await pool.query(`
      SELECT id, region_id, name,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM regions_boundaries
      ORDER BY name
    `);
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(`
      SELECT id, region_id, name,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM regions_boundaries
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
              'id', id,
              'region_id', region_id,
              'name', name
            ),
            'geometry', ST_AsGeoJSON(geometry)::json
          )
        ), '[]'::json)
      ) AS geojson
      FROM regions_boundaries
    `);
    return result.rows[0].geojson;
  },
};

module.exports = RegionBoundary;
