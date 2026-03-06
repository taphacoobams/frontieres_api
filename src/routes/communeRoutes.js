const { Router } = require('express');
const CommuneController = require('../controllers/communeController');

const router = Router();

router.get('/', CommuneController.getAll);
router.get('/:id', CommuneController.getById);

module.exports = router;
