const { Router } = require('express');
const regionRoutes = require('./regionRoutes');
const departementRoutes = require('./departementRoutes');
const communeRoutes = require('./communeRoutes');
const localiteRoutes = require('./localiteRoutes');
const mapRoutes = require('./mapRoutes');
const LocaliteController = require('../controllers/localiteController');
const PaysController = require('../controllers/paysController');

const router = Router();

router.use('/regions', regionRoutes);
router.use('/departements', departementRoutes);
router.use('/communes', communeRoutes);
router.use('/localites', localiteRoutes);
router.use('/map', mapRoutes);
router.get('/pays', PaysController.get);
router.get('/stats', LocaliteController.getStats);

module.exports = router;
