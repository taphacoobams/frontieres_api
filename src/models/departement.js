const pool = require('../database/connection');

const COLUMNS = `id, name, region_id, code, lat, lon, elevation,
       superficie_km2, population, densite,
       ST_AsGeoJSON(geometry)::json AS geometry`;

const PROPERTIES_SQL = `json_build_object(
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
)`;

function buildFilter(filters) {
  const conditions = [];
  const params = [];
  let idx = 1;
  if (filters.regionId) {
    conditions.push(`region_id = $${idx++}`);
    params.push(filters.regionId);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}

const Departement = {
  async findAll(regionId) {
    const { where, params } = buildFilter({ regionId });
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM departements ${where} ORDER BY name`, params
    );
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM departements WHERE id = $1`, [id]
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
      FROM departements
      ${where}
    `, params);
    return result.rows[0].geojson;
  },
};

module.exports = Departement;
