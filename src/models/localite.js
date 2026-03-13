const pool = require('../database/connection');

const COLUMNS = `id, name, commune_id, population`;

const PROPERTIES_SQL = `json_build_object(
  'id',         id,
  'name',       name,
  'commune_id', commune_id,
  'population', population
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
  if (filters.communeId) {
    conditions.push(`commune_id = $${idx++}`);
    params.push(filters.communeId);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params, idx };
}

const Localite = {
  async findAll({ communeId, departementId, regionId, limit, offset } = {}) {
    const { where, params, idx } = buildFilter({ communeId, departementId, regionId });
    let query = `SELECT ${COLUMNS} FROM localites ${where} ORDER BY name`;
    let nextIdx = idx;

    if (limit) {
      query += ` LIMIT $${nextIdx++}`;
      params.push(limit);
    }
    if (offset) {
      query += ` OFFSET $${nextIdx++}`;
      params.push(offset);
    }

    const result = await pool.query(query, params);
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM localites WHERE id = $1`, [id]
    );
    return result.rows[0] || null;
  },

  async search(q, { limit = 50 } = {}) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM localites WHERE name ILIKE $1 ORDER BY name LIMIT $2`,
      [`%${q}%`, limit]
    );
    return result.rows;
  },

  async findAllAsFeatureCollection({ communeId, departementId, regionId, limit } = {}) {
    const { where, params, idx } = buildFilter({ communeId, departementId, regionId });
    let limitClause = '';
    if (limit) {
      limitClause = `LIMIT $${idx}`;
      params.push(limit);
    }

    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', ${PROPERTIES_SQL},
            'geometry', NULL
          )
        ORDER BY name), '[]'::json)
      ) AS geojson
      FROM (
        SELECT * FROM localites
        ${where}
        ORDER BY name
        ${limitClause}
      ) sub
    `, params);
    return result.rows[0].geojson;
  },

  async count(filters = {}) {
    const { where, params } = buildFilter(filters);
    if (filters.withCoords) {
      const w = where ? where + ' AND lat IS NOT NULL' : 'WHERE lat IS NOT NULL';
      const result = await pool.query(`SELECT COUNT(*) FROM localites ${w}`, params);
      return parseInt(result.rows[0].count, 10);
    }
    const result = await pool.query(`SELECT COUNT(*) FROM localites ${where}`, params);
    return parseInt(result.rows[0].count, 10);
  },

  async getStats() {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM regions)      AS regions,
        (SELECT COUNT(*) FROM departements) AS departements,
        (SELECT COUNT(*) FROM communes)     AS communes,
        (SELECT COUNT(*) FROM localites)    AS localites,
        (SELECT COUNT(*) FROM localites WHERE lat IS NOT NULL) AS localites_with_coordinates,
        (SELECT COUNT(*) FROM localites WHERE population IS NOT NULL) AS localites_with_population
    `);
    return result.rows[0];
  },
};

module.exports = Localite;
