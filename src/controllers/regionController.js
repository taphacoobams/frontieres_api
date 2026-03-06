const RegionService = require('../services/regionService');

const RegionController = {
  async getAll(req, res) {
    try {
      const features = await RegionService.getAll();
      res.json(features);
    } catch (err) {
      console.error('Erreur GET /regions :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getById(req, res) {
    try {
      const feature = await RegionService.getById(req.params.id);
      if (!feature) {
        return res.status(404).json({ error: 'Région non trouvée' });
      }
      res.json(feature);
    } catch (err) {
      console.error('Erreur GET /regions/:id :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getFeatureCollection(req, res) {
    try {
      const fc = await RegionService.getFeatureCollection();
      res.json(fc);
    } catch (err) {
      console.error('Erreur GET /map/regions :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = RegionController;
