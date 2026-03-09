const { Router } = require('express');
const PaysController = require('../controllers/paysController');
const RegionController = require('../controllers/regionController');
const DepartementController = require('../controllers/departementController');
const CommuneController = require('../controllers/communeController');
const LocaliteController = require('../controllers/localiteController');

const router = Router();

router.get('/pays', PaysController.getFeatureCollection);
router.get('/regions', RegionController.getFeatureCollection);
router.get('/regions/:id/communes', CommuneController.getMapByRegion);
router.get('/regions/:id/localites', LocaliteController.getMapByRegion);
router.get('/departements', DepartementController.getFeatureCollection);
router.get('/departements/:id/communes', CommuneController.getMapByDepartement);
router.get('/departements/:id/localites', LocaliteController.getMapByDepartement);
router.get('/communes', CommuneController.getFeatureCollection);
router.get('/communes/:id/localites', LocaliteController.getMapByCommune);
router.get('/localites', LocaliteController.getFeatureCollection);

module.exports = router;
