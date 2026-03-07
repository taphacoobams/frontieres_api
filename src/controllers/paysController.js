const PaysService = require('../services/paysService');

const PaysController = {
  async get(req, res) {
    try {
      const data = await PaysService.get();
      if (!data) return res.status(404).json({ error: 'Données pays non trouvées' });
      res.json(data);
    } catch (err) {
      console.error('Erreur GET /pays :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getFeature(req, res) {
    try {
      const feature = await PaysService.getFeature();
      if (!feature) return res.status(404).json({ error: 'Géométrie pays non trouvée' });
      res.json(feature);
    } catch (err) {
      console.error('Erreur GET /map/pays :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = PaysController;
