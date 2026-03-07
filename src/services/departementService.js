const Departement = require('../models/departement');
const { getCached, setCache } = require('./cache');

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

  async getFeatureCollection({ regionId } = {}) {
    const cacheKey = `departements:fc:${regionId || 'none'}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const fc = await Departement.findAllAsFeatureCollection({ regionId });
    setCache(cacheKey, fc);
    return fc;
  },
};

module.exports = DepartementService;
