const LocaliteGeo = require('../models/localiteGeo');

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

const LocaliteService = {
  async getAll({ communeId, departementId, regionId, limit, offset } = {}) {
    const cacheKey = `localites:${communeId || ''}:${departementId || ''}:${regionId || ''}:${limit || ''}:${offset || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const rows = await LocaliteGeo.findAll({ communeId, departementId, regionId, limit, offset });
    setCache(cacheKey, rows);
    return rows;
  },

  async getById(id) {
    const row = await LocaliteGeo.findById(id);
    return row || null;
  },

  async search(q, options) {
    const cacheKey = `localites:search:${q}:${options?.limit || 50}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const rows = await LocaliteGeo.search(q, options);
    setCache(cacheKey, rows);
    return rows;
  },

  async count(filters) {
    return LocaliteGeo.count(filters);
  },

  async getStats() {
    const cacheKey = 'stats:all';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const stats = await LocaliteGeo.getStats();
    const result = {
      regions: parseInt(stats.regions, 10),
      departements: parseInt(stats.departements, 10),
      communes: parseInt(stats.communes, 10),
      localites: parseInt(stats.localites, 10),
      localites_with_coordinates: parseInt(stats.localites_with_coordinates, 10),
    };
    setCache(cacheKey, result);
    return result;
  },
};

module.exports = LocaliteService;
