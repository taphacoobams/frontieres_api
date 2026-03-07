const { Router } = require('express');
const RegionController = require('../controllers/regionController');
const DepartementController = require('../controllers/departementController');

const router = Router();

router.get('/', RegionController.getAll);
router.get('/:id', RegionController.getById);
router.get('/:id/departements', DepartementController.getByRegion);

module.exports = router;
