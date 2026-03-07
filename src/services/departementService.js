const Departement = require('../models/departement');

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

const DepartementService = {
  async getAll(regionId) {
    const cacheKey = `departements:all:${regionId || 'none'}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const rows = await Departement.findAll(regionId);
    setCache(cacheKey, rows);
    return rows;
  },

  async getById(id) {
    return Departement.findById(id);
  },

  async getFeatureCollection(regionId) {
    const cacheKey = `departements:fc:${regionId || 'none'}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const fc = await Departement.findAllAsFeatureCollection(regionId);
    setCache(cacheKey, fc);
    return fc;
  },
};

module.exports = DepartementService;
