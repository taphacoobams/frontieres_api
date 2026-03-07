const { Router } = require('express');
const DepartementController = require('../controllers/departementController');
const CommuneController = require('../controllers/communeController');

const router = Router();

router.get('/', DepartementController.getAll);
router.get('/:id', DepartementController.getById);
router.get('/:id/communes', CommuneController.getByDepartement);

module.exports = router;
