const CommuneService = require('../services/communeService');

const CommuneController = {
  async getAll(req, res) {
    try {
      const departementId = req.query.departement_id || null;
      const features = await CommuneService.getAll(departementId);
      res.json(features);
    } catch (err) {
      console.error('Erreur GET /communes :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getById(req, res) {
    try {
      const feature = await CommuneService.getById(req.params.id);
      if (!feature) {
        return res.status(404).json({ error: 'Commune non trouvée' });
      }
      res.json(feature);
    } catch (err) {
      console.error('Erreur GET /communes/:id :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getFeatureCollection(req, res) {
    try {
      const departementId = req.query.departement_id || null;
      const fc = await CommuneService.getFeatureCollection(departementId);
      res.json(fc);
    } catch (err) {
      console.error('Erreur GET /map/communes :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = CommuneController;
