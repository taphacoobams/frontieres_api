const Region = require('../models/region');
const { getCached, setCache } = require('./cache');

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
