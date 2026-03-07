const CommuneService = require('../services/communeService');

const CommuneController = {
  async getAll(req, res) {
    try {
      const regionId = req.query.region_id || null;
      const departementId = req.query.departement_id || null;
      const rows = await CommuneService.getAll({ regionId, departementId });
      res.json(rows);
    } catch (err) {
      console.error('Erreur GET /communes :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getById(req, res) {
    try {
      const row = await CommuneService.getById(req.params.id);
      if (!row) {
        return res.status(404).json({ error: 'Commune non trouvée' });
      }
      res.json(row);
    } catch (err) {
      console.error('Erreur GET /communes/:id :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getByDepartement(req, res) {
    try {
      const rows = await CommuneService.getAll({ departementId: req.params.id });
      res.json(rows);
    } catch (err) {
      console.error('Erreur GET /departements/:id/communes :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getFeatureCollection(req, res) {
    try {
      const regionId = req.query.region_id || null;
      const departementId = req.query.departement_id || null;
      const fc = await CommuneService.getFeatureCollection({ regionId, departementId });
      res.json(fc);
    } catch (err) {
      console.error('Erreur GET /map/communes :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = CommuneController;
