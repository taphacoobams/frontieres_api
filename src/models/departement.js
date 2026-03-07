const pool = require('../database/connection');

const Departement = {
  async findAll(regionId) {
    let query = `
      SELECT id, name, region_id, code, lat, lon, elevation,
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
      SELECT id, name, region_id, code, lat, lon, elevation,
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
              'name',           name,
              'region_id',      region_id,
              'code',           code,
              'lat',            lat,
              'lon',            lon,
              'elevation',      elevation,
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
