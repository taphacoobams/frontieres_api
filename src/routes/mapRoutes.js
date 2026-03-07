const { Router } = require('express');
const PaysController = require('../controllers/paysController');
const RegionController = require('../controllers/regionController');
const DepartementController = require('../controllers/departementController');
const CommuneController = require('../controllers/communeController');
const LocaliteController = require('../controllers/localiteController');

const router = Router();

router.get('/pays', PaysController.getFeature);
router.get('/regions', RegionController.getFeatureCollection);
router.get('/departements', DepartementController.getFeatureCollection);
router.get('/communes', CommuneController.getFeatureCollection);
router.get('/localites', LocaliteController.getFeatureCollection);

module.exports = router;
