const pool = require('../database/connection');

const LocaliteGeo = {
  async findAll({ communeId, departementId, regionId, limit, offset } = {}) {
    let query = `
      SELECT id, name, commune_id, departement_id, region_id,
             latitude, longitude, source, elevation, superficie_km2,
             ST_AsGeoJSON(geom_point)::json AS geom_point,
             ST_AsGeoJSON(geom_polygon)::json AS geom_polygon
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
             latitude, longitude, source, elevation, superficie_km2,
             ST_AsGeoJSON(geom_point)::json AS geom_point,
             ST_AsGeoJSON(geom_polygon)::json AS geom_polygon
      FROM localites
      WHERE id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  async search(q, { limit = 50 } = {}) {
    const result = await pool.query(`
      SELECT id, name, commune_id, departement_id, region_id,
             latitude, longitude, source, elevation, superficie_km2,
             ST_AsGeoJSON(geom_point)::json AS geom_point,
             ST_AsGeoJSON(geom_polygon)::json AS geom_polygon
      FROM localites
      WHERE name ILIKE $1
      ORDER BY name
      LIMIT $2
    `, [`%${q}%`, limit]);
    return result.rows;
  },

  async findAllAsFeatureCollection({ communeId, departementId, regionId, limit = 500 } = {}) {
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

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit);

    const result = await pool.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'name', name,
              'commune_id', commune_id,
              'departement_id', departement_id,
              'region_id', region_id,
              'latitude', latitude,
              'longitude', longitude,
              'elevation', elevation,
              'superficie_km2', superficie_km2,
              'source', source
            ),
            'geometry', COALESCE(
              ST_AsGeoJSON(geom_polygon)::json,
              ST_AsGeoJSON(geom_point)::json
            )
          )
        ), '[]'::json)
      ) AS geojson
      FROM (
        SELECT * FROM localites
        ${whereClause}
        ORDER BY name
        LIMIT $${paramIdx}
      ) sub
    `, params);
    return result.rows[0].geojson;
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
