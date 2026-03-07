const Pays = require('../models/pays');

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

const PaysService = {
  async get() {
    const cacheKey = 'pays:one';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const row = await Pays.find();
    if (!row) return null;

    const data = {
      name: row.name,
      superficie_km2: row.superficie_km2,
      population: row.population,
      densite: row.densite,
    };
    setCache(cacheKey, data);
    return data;
  },

  async getFeature() {
    const cacheKey = 'pays:feature';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const feature = await Pays.findAsFeature();
    setCache(cacheKey, feature);
    return feature;
  },
};

module.exports = PaysService;
