require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3005;

// Sécurité
app.use(helmet());
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

// Swagger docs
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customSiteTitle: 'Frontières API – Documentation',
}));

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
    console.log(`  GET /api/regions`);
    console.log(`  GET /api/regions/:id`);
    console.log(`  GET /api/departements`);
    console.log(`  GET /api/departements/:id`);
    console.log(`  GET /api/departements?region_id=`);
    console.log(`  GET /api/communes`);
    console.log(`  GET /api/communes/:id`);
    console.log(`  GET /api/communes?departement_id=`);
    console.log(`  GET /api/localites`);
    console.log(`  GET /api/localites/:id`);
    console.log(`  GET /api/localites/search?q=`);
    console.log(`  GET /api/localites?commune_id=`);
    console.log(`  GET /api/localites?departement_id=`);
    console.log(`  GET /api/localites?region_id=`);
    console.log(`  GET /api/map/regions`);
    console.log(`  GET /api/map/departements`);
    console.log(`  GET /api/map/communes`);
    console.log(`  GET /api/docs`);
  });
}

module.exports = app;
