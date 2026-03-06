const RegionBoundary = require('../models/regionBoundary');

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

    const rows = await RegionBoundary.findAll();
    const features = rows.map((row) => ({
      type: 'Feature',
      properties: { id: row.id, region_id: row.region_id, name: row.name },
      geometry: row.geometry,
    }));
    setCache(cacheKey, features);
    return features;
  },

  async getById(id) {
    const row = await RegionBoundary.findById(id);
    if (!row) return null;
    return {
      type: 'Feature',
      properties: { id: row.id, region_id: row.region_id, name: row.name },
      geometry: row.geometry,
    };
  },

  async getFeatureCollection() {
    const cacheKey = 'regions:fc';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const fc = await RegionBoundary.findAllAsFeatureCollection();
    setCache(cacheKey, fc);
    return fc;
  },
};

module.exports = RegionService;
