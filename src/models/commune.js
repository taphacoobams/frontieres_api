const pool = require('../database/connection');

const Commune = {
  async findAll(departementId) {
    let query = `
      SELECT id, commune_id, departement_id, name, lat, lon,
             superficie_km2, population, densite,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM communes
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
      SELECT id, commune_id, departement_id, name, lat, lon,
             superficie_km2, population, densite,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM communes
      WHERE id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  async findAllAsFeatureCollection(departementId) {
    const params = [];
    let whereClause = '';
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
              'id',             id,
              'commune_id',     commune_id,
              'departement_id', departement_id,
              'name',           name,
              'lat',            lat,
              'lon',            lon,
              'superficie_km2', superficie_km2,
              'population',     population,
              'densite',        densite
            ),
            'geometry', ST_AsGeoJSON(geometry)::json
          )
        ORDER BY name), '[]'::json)
      ) AS geojson
      FROM communes
      ${whereClause}
    `, params);
    return result.rows[0].geojson;
  },
};

module.exports = Commune;
