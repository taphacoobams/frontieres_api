const { Router } = require('express');
const DepartementController = require('../controllers/departementController');
const CommuneController = require('../controllers/communeController');
const LocaliteController = require('../controllers/localiteController');

const router = Router();

router.get('/', DepartementController.getAll);
router.get('/:id', DepartementController.getById);
router.get('/:id/communes', CommuneController.getByDepartement);
router.get('/:id/localites', LocaliteController.getByDepartement);

module.exports = router;
