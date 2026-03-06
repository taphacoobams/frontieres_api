const CommuneBoundary = require('../models/communeBoundary');

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

const CommuneService = {
  async getAll(departementId) {
    const cacheKey = `communes:all:${departementId || 'none'}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const rows = await CommuneBoundary.findAll(departementId);
    const features = rows.map((row) => ({
      type: 'Feature',
      properties: {
        id: row.id,
        commune_id: row.commune_id,
        departement_id: row.departement_id,
        name: row.name,
      },
      geometry: row.geometry,
    }));
    setCache(cacheKey, features);
    return features;
  },

  async getById(id) {
    const row = await CommuneBoundary.findById(id);
    if (!row) return null;
    return {
      type: 'Feature',
      properties: {
        id: row.id,
        commune_id: row.commune_id,
        departement_id: row.departement_id,
        name: row.name,
      },
      geometry: row.geometry,
    };
  },

  async getFeatureCollection(departementId) {
    const cacheKey = `communes:fc:${departementId || 'none'}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const fc = await CommuneBoundary.findAllAsFeatureCollection(departementId);
    setCache(cacheKey, fc);
    return fc;
  },
};

module.exports = CommuneService;
