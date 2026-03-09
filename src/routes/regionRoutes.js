const { Router } = require('express');
const RegionController = require('../controllers/regionController');
const DepartementController = require('../controllers/departementController');
const CommuneController = require('../controllers/communeController');
const LocaliteController = require('../controllers/localiteController');

const router = Router();

router.get('/', RegionController.getAll);
router.get('/:id', RegionController.getById);
router.get('/:id/departements', DepartementController.getByRegion);
router.get('/:id/communes', CommuneController.getByRegion);
router.get('/:id/localites', LocaliteController.getByRegion);

module.exports = router;
