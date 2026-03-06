const DepartementService = require('../services/departementService');

const DepartementController = {
  async getAll(req, res) {
    try {
      const regionId = req.query.region_id || null;
      const features = await DepartementService.getAll(regionId);
      res.json(features);
    } catch (err) {
      console.error('Erreur GET /departements :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getById(req, res) {
    try {
      const feature = await DepartementService.getById(req.params.id);
      if (!feature) {
        return res.status(404).json({ error: 'Département non trouvé' });
      }
      res.json(feature);
    } catch (err) {
      console.error('Erreur GET /departements/:id :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getFeatureCollection(req, res) {
    try {
      const regionId = req.query.region_id || null;
      const fc = await DepartementService.getFeatureCollection(regionId);
      res.json(fc);
    } catch (err) {
      console.error('Erreur GET /map/departements :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = DepartementController;
