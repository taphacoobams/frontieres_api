const Commune = require('../models/commune');
const { getCached, setCache } = require('./cache');

const CommuneService = {
  async getAll(filters = {}) {
    const f = typeof filters === 'object' ? filters : { departementId: filters };
    const cacheKey = `communes:all:${f.regionId || ''}:${f.departementId || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const rows = await Commune.findAll(f);
    setCache(cacheKey, rows);
    return rows;
  },

  async getById(id) {
    return Commune.findById(id);
  },

  async getFeatureCollection({ regionId, departementId } = {}) {
    const cacheKey = `communes:fc:${regionId || ''}:${departementId || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const fc = await Commune.findAllAsFeatureCollection({ regionId, departementId });
    setCache(cacheKey, fc);
    return fc;
  },
};

module.exports = CommuneService;
