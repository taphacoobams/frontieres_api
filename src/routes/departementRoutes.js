const { Router } = require('express');
const DepartementController = require('../controllers/departementController');

const router = Router();

router.get('/', DepartementController.getAll);
router.get('/:id', DepartementController.getById);

module.exports = router;
