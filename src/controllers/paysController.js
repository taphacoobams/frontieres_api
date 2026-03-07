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

  async getFeatureCollection(req, res) {
    try {
      const fc = await PaysService.getFeatureCollection();
      res.json(fc);
    } catch (err) {
      console.error('Erreur GET /map/pays :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = PaysController;
