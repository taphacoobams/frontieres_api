require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'frontieres-api' });
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

app.listen(PORT, () => {
  console.log(`frontieres-api démarrée sur le port ${PORT}`);
  console.log(`Endpoints disponibles :`);
  console.log(`  GET /api/regions`);
  console.log(`  GET /api/regions/:id`);
  console.log(`  GET /api/departements`);
  console.log(`  GET /api/departements/:id`);
  console.log(`  GET /api/departements?region_id=`);
  console.log(`  GET /api/communes`);
  console.log(`  GET /api/communes/:id`);
  console.log(`  GET /api/communes?departement_id=`);
  console.log(`  GET /api/map/regions`);
  console.log(`  GET /api/map/departements`);
  console.log(`  GET /api/map/communes`);
});
