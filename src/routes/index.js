const { Router } = require('express');
const regionRoutes = require('./regionRoutes');
const departementRoutes = require('./departementRoutes');
const communeRoutes = require('./communeRoutes');
const mapRoutes = require('./mapRoutes');

const router = Router();

router.use('/regions', regionRoutes);
router.use('/departements', departementRoutes);
router.use('/communes', communeRoutes);
router.use('/map', mapRoutes);

module.exports = router;
