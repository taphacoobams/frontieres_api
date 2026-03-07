const Commune = require('../models/commune');

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

    const rows = await Commune.findAll(departementId);
    setCache(cacheKey, rows);
    return rows;
  },

  async getById(id) {
    return Commune.findById(id);
  },

  async getFeatureCollection(departementId) {
    const cacheKey = `communes:fc:${departementId || 'none'}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const fc = await Commune.findAllAsFeatureCollection(departementId);
    setCache(cacheKey, fc);
    return fc;
  },
};

module.exports = CommuneService;
