const pool = require('../database/connection');

const CommuneBoundary = {
  async findAll(departementId) {
    let query = `
      SELECT id, commune_id, departement_id, name,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM communes_boundaries
    `;
    const params = [];

    if (departementId) {
      query += ' WHERE departement_id = $1';
      params.push(departementId);
    }

    query += ' ORDER BY name';
    const result = await pool.query(query, params);
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(`
      SELECT id, commune_id, departement_id, name,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM communes_boundaries
      WHERE id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  async findAllAsFeatureCollection(departementId) {
    let whereClause = '';
    const params = [];

    if (departementId) {
      whereClause = 'WHERE departement_id = $1';
      params.push(departementId);
    }

    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'commune_id', commune_id,
              'departement_id', departement_id,
              'name', name
            ),
            'geometry', ST_AsGeoJSON(geometry)::json
          )
        ), '[]'::json)
      ) AS geojson
      FROM communes_boundaries
      ${whereClause}
    `, params);
    return result.rows[0].geojson;
  },
};

module.exports = CommuneBoundary;
