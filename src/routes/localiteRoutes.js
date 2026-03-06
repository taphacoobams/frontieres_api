const { Router } = require('express');
const LocaliteController = require('../controllers/localiteController');

const router = Router();

router.get('/search', LocaliteController.search);
router.get('/', LocaliteController.getAll);
router.get('/:id', LocaliteController.getById);

module.exports = router;
