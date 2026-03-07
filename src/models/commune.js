const pool = require('../database/connection');

const COLUMNS = `id, name, region_id, departement_id, lat, lon, elevation,
       superficie_km2, population, densite,
       ST_AsGeoJSON(geometry)::json AS geometry`;

const PROPERTIES_SQL = `json_build_object(
  'id',             id,
  'name',           name,
  'region_id',      region_id,
  'departement_id', departement_id,
  'lat',            lat,
  'lon',            lon,
  'elevation',      elevation,
  'superficie_km2', superficie_km2,
  'population',     population,
  'densite',        densite
)`;

function buildFilter(filters) {
  const conditions = [];
  const params = [];
  let idx = 1;
  if (filters.regionId) {
    conditions.push(`region_id = $${idx++}`);
    params.push(filters.regionId);
  }
  if (filters.departementId) {
    conditions.push(`departement_id = $${idx++}`);
    params.push(filters.departementId);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}

const Commune = {
  async findAll(filters = {}) {
    const f = typeof filters === 'object' ? filters : { departementId: filters };
    const { where, params } = buildFilter(f);
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM communes ${where} ORDER BY name`, params
    );
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM communes WHERE id = $1`, [id]
    );
    return result.rows[0] || null;
  },

  async findAllAsFeatureCollection(filters = {}) {
    const { where, params } = buildFilter(filters);
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
      FROM communes
      ${where}
    `, params);
    return result.rows[0].geojson;
  },
};

module.exports = Commune;
