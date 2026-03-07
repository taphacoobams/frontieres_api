const Region = require('../models/region');

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

const RegionService = {
  async getAll() {
    const cacheKey = 'regions:all';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const rows = await Region.findAll();
    setCache(cacheKey, rows);
    return rows;
  },

  async getById(id) {
    return Region.findById(id);
  },

  async getFeatureCollection() {
    const cacheKey = 'regions:fc';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const fc = await Region.findAllAsFeatureCollection();
    setCache(cacheKey, fc);
    return fc;
  },
};

module.exports = RegionService;
