const pool = require('../database/connection');

const Pays = {
  async find() {
    const result = await pool.query(`
      SELECT id, name,
             superficie_km2, population, densite,
             ST_AsGeoJSON(geometry)::json AS geometry
      FROM pays
      LIMIT 1
    `);
    return result.rows[0] || null;
  },

  async findAsFeature() {
    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'Feature',
        'properties', json_build_object(
          'id',             id,
          'name',           name,
          'superficie_km2', superficie_km2,
          'population',     population,
          'densite',        densite
        ),
        'geometry', ST_AsGeoJSON(geometry)::json
      ) AS feature
      FROM pays
      LIMIT 1
    `);
    return result.rows[0]?.feature || null;
  },
};

module.exports = Pays;
