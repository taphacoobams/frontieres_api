const LocaliteService = require('../services/localiteService');

const LocaliteController = {
  async getAll(req, res) {
    try {
      const { commune_id, departement_id, region_id, limit, offset } = req.query;
      const rows = await LocaliteService.getAll({
        communeId: commune_id || null,
        departementId: departement_id || null,
        regionId: region_id || null,
        limit: limit ? parseInt(limit, 10) : null,
        offset: offset ? parseInt(offset, 10) : null,
      });
      res.json(rows);
    } catch (err) {
      console.error('Erreur GET /localites :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getById(req, res) {
    try {
      const row = await LocaliteService.getById(req.params.id);
      if (!row) {
        return res.status(404).json({ error: 'Localité non trouvée' });
      }
      res.json(row);
    } catch (err) {
      console.error('Erreur GET /localites/:id :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async search(req, res) {
    try {
      const q = req.query.q;
      if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: 'Le paramètre q doit contenir au moins 2 caractères' });
      }
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      const rows = await LocaliteService.search(q.trim(), { limit });
      res.json(rows);
    } catch (err) {
      console.error('Erreur GET /localites/search :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getFeatureCollection(req, res) {
    try {
      const { commune_id, departement_id, region_id, limit } = req.query;
      const geojson = await LocaliteService.getFeatureCollection({
        communeId: commune_id || null,
        departementId: departement_id || null,
        regionId: region_id || null,
        limit: limit ? parseInt(limit, 10) : 500,
      });
      res.json(geojson);
    } catch (err) {
      console.error('Erreur GET /map/localites :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  async getStats(req, res) {
    try {
      const stats = await LocaliteService.getStats();
      res.json(stats);
    } catch (err) {
      console.error('Erreur GET /stats :', err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = LocaliteController;
