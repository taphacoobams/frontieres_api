const pool = require('../database/connection');

const Departement = {
  async findAll(regionId) {
    let query = `
      SELECT id, departement_id, region_id, name, lat, lon,
             superficie_km2, population, densite,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM departements
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
      SELECT id, departement_id, region_id, name, lat, lon,
             superficie_km2, population, densite,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM departements
      WHERE id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  async findAllAsFeatureCollection(regionId) {
    const params = [];
    let whereClause = '';
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
              'id',             id,
              'departement_id', departement_id,
              'region_id',      region_id,
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
      FROM departements
      ${whereClause}
    `, params);
    return result.rows[0].geojson;
  },
};

module.exports = Departement;
