const Localite = require('../models/localite');
const { getCached, setCache } = require('./cache');

const LocaliteService = {
  async getAll({ communeId, departementId, regionId, limit, offset } = {}) {
    const cacheKey = `localites:${communeId || ''}:${departementId || ''}:${regionId || ''}:${limit || ''}:${offset || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const rows = await Localite.findAll({ communeId, departementId, regionId, limit, offset });
    setCache(cacheKey, rows);
    return rows;
  },

  async getById(id) {
    return Localite.findById(id);
  },

  async search(q, options) {
    const cacheKey = `localites:search:${q}:${options?.limit || 50}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const rows = await Localite.search(q, options);
    setCache(cacheKey, rows);
    return rows;
  },

  async getFeatureCollection({ communeId, departementId, regionId, limit } = {}) {
    const cacheKey = `localites:fc:${communeId || ''}:${departementId || ''}:${regionId || ''}:${limit || 'all'}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const geojson = await Localite.findAllAsFeatureCollection({ communeId, departementId, regionId, limit });
    setCache(cacheKey, geojson);
    return geojson;
  },

  async count(filters) {
    return Localite.count(filters);
  },

  async getStats() {
    const cacheKey = 'stats:all';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const stats = await Localite.getStats();
    const result = {
      regions: parseInt(stats.regions, 10),
      departements: parseInt(stats.departements, 10),
      communes: parseInt(stats.communes, 10),
      localites: parseInt(stats.localites, 10),
      localites_with_coordinates: parseInt(stats.localites_with_coordinates, 10),
      localites_with_population: parseInt(stats.localites_with_population, 10),
    };
    setCache(cacheKey, result);
    return result;
  },
};

module.exports = LocaliteService;
