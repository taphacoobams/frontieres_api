const pool = require('../database/connection');

const LocaliteGeo = {
  async findAll({ communeId, departementId, regionId, limit, offset } = {}) {
    let query = `
      SELECT id, name, commune_id, departement_id, region_id,
             latitude, longitude, source, elevation
      FROM localites
    `;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (regionId) {
      conditions.push(`region_id = $${paramIdx++}`);
      params.push(regionId);
    }
    if (departementId) {
      conditions.push(`departement_id = $${paramIdx++}`);
      params.push(departementId);
    }
    if (communeId) {
      conditions.push(`commune_id = $${paramIdx++}`);
      params.push(communeId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY name';

    if (limit) {
      query += ` LIMIT $${paramIdx++}`;
      params.push(limit);
    }
    if (offset) {
      query += ` OFFSET $${paramIdx++}`;
      params.push(offset);
    }

    const result = await pool.query(query, params);
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(`
      SELECT id, name, commune_id, departement_id, region_id,
             latitude, longitude, source, elevation
      FROM localites
      WHERE id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  async search(q, { limit = 50 } = {}) {
    const result = await pool.query(`
      SELECT id, name, commune_id, departement_id, region_id,
             latitude, longitude, source, elevation
      FROM localites
      WHERE name ILIKE $1
      ORDER BY name
      LIMIT $2
    `, [`%${q}%`, limit]);
    return result.rows;
  },

  async count(filters = {}) {
    let query = 'SELECT COUNT(*) FROM localites';
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (filters.communeId) {
      conditions.push(`commune_id = $${paramIdx++}`);
      params.push(filters.communeId);
    }
    if (filters.departementId) {
      conditions.push(`departement_id = $${paramIdx++}`);
      params.push(filters.departementId);
    }
    if (filters.regionId) {
      conditions.push(`region_id = $${paramIdx++}`);
      params.push(filters.regionId);
    }
    if (filters.withCoords) {
      conditions.push('latitude IS NOT NULL');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].count, 10);
  },

  async getStats() {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM regions_boundaries) AS regions,
        (SELECT COUNT(*) FROM departements_boundaries) AS departements,
        (SELECT COUNT(*) FROM communes_boundaries) AS communes,
        (SELECT COUNT(*) FROM localites) AS localites,
        (SELECT COUNT(*) FROM localites WHERE latitude IS NOT NULL) AS localites_with_coordinates
    `);
    return result.rows[0];
  },
};

module.exports = LocaliteGeo;
