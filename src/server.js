require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3005;

// Sécurité
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.redoc.ly"],
      scriptSrcElem: ["'self'", "'unsafe-inline'", "https://cdn.redoc.ly"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://cdn.redoc.ly"],
      workerSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors());

// Compression gzip
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});
app.use(limiter);

// JSON parsing
app.use(express.json());

// Welcome route
app.get('/', (req, res) => {
  res.json({
    welcome: "Bienvenue dans l'API des Frontières Administratives du Sénégal. Cette API fournit les polygones géographiques (GeoJSON) et les données des 14 régions, 46 départements, 552 communes et 25 515 localités du Sénégal. Pour plus d'informations, rendez-vous sur https://github.com/taphacoobams/frontieres_api"
  });
});

// OpenAPI spec
app.get('/api/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.json'));
});

// Documentation Redoc
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>API Découpage Administratif du Sénégal - Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
  <style>body { margin: 0; padding: 0; }</style>
</head>
<body>
  <redoc spec-url='/api/openapi.json'></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`);
});

// Routes
app.use('/api', routes);

// Health check
app.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    const pool = require('./database/connection');
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error';
  }
  res.json({
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    service: 'frontieres-api',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Erreur non gérée :', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`frontieres-api démarrée sur le port ${PORT}`);
    console.log(`Endpoints disponibles :`);
    console.log(`  GET /health`);
    console.log(`  GET /api/stats`);
    console.log(`  GET /api/pays`);
    console.log(`  GET /api/regions`);
    console.log(`  GET /api/regions/:id`);
    console.log(`  GET /api/regions/:id/departements`);
    console.log(`  GET /api/regions/:id/communes`);
    console.log(`  GET /api/regions/:id/localites`);
    console.log(`  GET /api/departements`);
    console.log(`  GET /api/departements/:id`);
    console.log(`  GET /api/departements?region_id=`);
    console.log(`  GET /api/departements/:id/communes`);
    console.log(`  GET /api/departements/:id/localites`);
    console.log(`  GET /api/communes`);
    console.log(`  GET /api/communes/:id`);
    console.log(`  GET /api/communes?departement_id=`);
    console.log(`  GET /api/communes?region_id=`);
    console.log(`  GET /api/communes/:id/localites`);
    console.log(`  GET /api/localites`);
    console.log(`  GET /api/localites/:id`);
    console.log(`  GET /api/localites/search?q=`);
    console.log(`  GET /api/localites?commune_id=`);
    console.log(`  GET /api/localites?departement_id=`);
    console.log(`  GET /api/localites?region_id=`);
    console.log(`  GET /api/map/pays`);
    console.log(`  GET /api/map/regions`);
    console.log(`  GET /api/map/regions/:id/communes`);
    console.log(`  GET /api/map/regions/:id/localites`);
    console.log(`  GET /api/map/departements`);
    console.log(`  GET /api/map/departements?region_id=`);
    console.log(`  GET /api/map/departements/:id/communes`);
    console.log(`  GET /api/map/departements/:id/localites`);
    console.log(`  GET /api/map/communes`);
    console.log(`  GET /api/map/communes?departement_id=`);
    console.log(`  GET /api/map/communes?region_id=`);
    console.log(`  GET /api/map/communes/:id/localites`);
    console.log(`  GET /api/map/localites`);
    console.log(`  GET /api/map/localites?commune_id=`);
    console.log(`  GET /api/map/localites?departement_id=`);
    console.log(`  GET /api/map/localites?region_id=`);
    console.log(`  GET /docs`);
    console.log(`  GET /api/openapi.json`);
  });
}

module.exports = app;
