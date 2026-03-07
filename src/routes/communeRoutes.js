const { Router } = require('express');
const CommuneController = require('../controllers/communeController');
const LocaliteController = require('../controllers/localiteController');

const router = Router();

router.get('/', CommuneController.getAll);
router.get('/:id', CommuneController.getById);
router.get('/:id/localites', LocaliteController.getByCommune);

module.exports = router;
