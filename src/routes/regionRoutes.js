const { Router } = require('express');
const RegionController = require('../controllers/regionController');

const router = Router();

router.get('/', RegionController.getAll);
router.get('/:id', RegionController.getById);

module.exports = router;
