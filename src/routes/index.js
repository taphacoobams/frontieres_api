const { Router } = require('express');
const regionRoutes = require('./regionRoutes');
const departementRoutes = require('./departementRoutes');
const communeRoutes = require('./communeRoutes');
const localiteRoutes = require('./localiteRoutes');
const mapRoutes = require('./mapRoutes');
const LocaliteController = require('../controllers/localiteController');

const router = Router();

router.use('/regions', regionRoutes);
router.use('/departements', departementRoutes);
router.use('/communes', communeRoutes);
router.use('/localites', localiteRoutes);
router.use('/map', mapRoutes);
router.get('/stats', LocaliteController.getStats);

module.exports = router;
