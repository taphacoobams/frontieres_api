const pool = require('../database/connection');

const DepartementBoundary = {
  async findAll(regionId) {
    let query = `
      SELECT id, departement_id, region_id, name,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM departements_boundaries
    `;
    const params = [];

    if (regionId) {
      query += ' WHERE region_id = $1';
      params.push(regionId);
    }

    query += ' ORDER BY name';
    const result = await pool.query(query, params);
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(`
      SELECT id, departement_id, region_id, name,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM departements_boundaries
      WHERE id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  async findAllAsFeatureCollection(regionId) {
    let whereClause = '';
    const params = [];

    if (regionId) {
      whereClause = 'WHERE region_id = $1';
      params.push(regionId);
    }

    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'departement_id', departement_id,
              'region_id', region_id,
              'name', name
            ),
            'geometry', ST_AsGeoJSON(geometry)::json
          )
        ), '[]'::json)
      ) AS geojson
      FROM departements_boundaries
      ${whereClause}
    `, params);
    return result.rows[0].geojson;
  },
};

module.exports = DepartementBoundary;
