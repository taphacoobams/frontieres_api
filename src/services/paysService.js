const Pays = require('../models/pays');
const { getCached, setCache } = require('./cache');

const PaysService = {
  async get() {
    const cacheKey = 'pays:one';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const row = await Pays.findById();
    setCache(cacheKey, row);
    return row;
  },

  async getFeature() {
    const cacheKey = 'pays:feature';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const feature = await Pays.findAsFeature();
    setCache(cacheKey, feature);
    return feature;
  },

  async getFeatureCollection() {
    const cacheKey = 'pays:fc';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const fc = await Pays.findAllAsFeatureCollection();
    setCache(cacheKey, fc);
    return fc;
  },
};

module.exports = PaysService;
