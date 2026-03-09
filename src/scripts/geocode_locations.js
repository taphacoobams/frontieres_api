/**
 * geocode_locations.js
 *
 * Geocodes communes and localities without coordinates using Nominatim (OpenStreetMap).
 * - Skips records that already have lat/lon
 * - Retries failed requests once
 * - Respects the 1 request/second Nominatim rate limit
 * - Logs progress every 50 processed records
 * - Writes unresolved locations to output/missing_locations.json
 *
 * Usage: npm run geocode-locations
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const OUTPUT_DIR  = path.join(__dirname, '../../output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'missing_locations.json');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const RATE_LIMIT_MS = 1100;
const PROGRESS_EVERY = 50;
const USER_AGENT = 'frontieres-api-geocoder/1.0 (contact@frontieres-api)';

const missing = { communes: [], localites: [] };

// ─── helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function nominatim(query, attempt = 1) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=sn`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fr' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
    return null;
  } catch (err) {
    if (attempt === 1) {
      console.warn(`  ↻ Retry pour: "${query}" (${err.message})`);
      await sleep(RATE_LIMIT_MS);
      return nominatim(query, 2);
    }
    console.warn(`  ✗ Échec définitif: "${query}" — ${err.message}`);
    return null;
  }
}

function logProgress(processed, total, entity) {
  if (processed % PROGRESS_EVERY === 0 || processed === total) {
    const pct = ((processed / total) * 100).toFixed(1);
    console.log(`  [${entity}] ${processed}/${total} (${pct}%)`);
  }
}

// ─── communes ───────────────────────────────────────────────────────────────

async function geocodeCommunes(client) {
  console.log('\n=== Géocodage des communes ===');

  const { rows } = await client.query(`
    SELECT c.id, c.name,
           d.name AS departement_name,
           r.name AS region_name
    FROM communes c
    LEFT JOIN departements d ON d.id = c.departement_id
    LEFT JOIN regions      r ON r.id = c.region_id
    WHERE c.lat IS NULL OR c.lon IS NULL
    ORDER BY c.id
  `);

  if (rows.length === 0) {
    console.log('  ✓ Toutes les communes ont déjà des coordonnées.');
    return;
  }

  console.log(`  ${rows.length} communes sans coordonnées.\n`);

  let processed = 0;
  let updated   = 0;

  for (const row of rows) {
    const parts = [row.name, row.departement_name, row.region_name, 'Sénégal']
      .filter(Boolean);
    const query = parts.join(', ');

    await sleep(RATE_LIMIT_MS);
    const coords = await nominatim(query);
    processed++;

    if (coords) {
      await client.query(
        'UPDATE communes SET lat = $1, lon = $2 WHERE id = $3',
        [coords.lat, coords.lon, row.id]
      );
      updated++;
    } else {
      missing.communes.push({
        id:     row.id,
        name:   row.name,
        region: row.region_name || null,
      });
    }

    logProgress(processed, rows.length, 'communes');
  }

  console.log(`\n  ✓ ${updated} communes mises à jour.`);
  console.log(`  ✗ ${rows.length - updated} communes sans résultat.`);
}

// ─── localites ──────────────────────────────────────────────────────────────

async function geocodeLocalites(client) {
  console.log('\n=== Géocodage des localités ===');

  const { rows } = await client.query(`
    SELECT l.id, l.name,
           c.name AS commune_name,
           d.name AS departement_name,
           r.name AS region_name
    FROM localites l
    LEFT JOIN communes    c ON c.id = l.commune_id
    LEFT JOIN departements d ON d.id = l.departement_id
    LEFT JOIN regions      r ON r.id = l.region_id
    WHERE l.lat IS NULL OR l.lon IS NULL
    ORDER BY l.id
  `);

  if (rows.length === 0) {
    console.log('  ✓ Toutes les localités ont déjà des coordonnées.');
    return;
  }

  console.log(`  ${rows.length} localités sans coordonnées.\n`);

  let processed = 0;
  let updated   = 0;

  for (const row of rows) {
    const parts = [row.name, row.commune_name, row.region_name, 'Sénégal']
      .filter(Boolean);
    const query = parts.join(', ');

    await sleep(RATE_LIMIT_MS);
    const coords = await nominatim(query);
    processed++;

    if (coords) {
      await client.query(
        'UPDATE localites SET lat = $1, lon = $2 WHERE id = $3',
        [coords.lat, coords.lon, row.id]
      );
      updated++;
    } else {
      missing.localites.push({
        id:      row.id,
        name:    row.name,
        commune: row.commune_name || null,
        region:  row.region_name  || null,
      });
    }

    logProgress(processed, rows.length, 'localités');
  }

  console.log(`\n  ✓ ${updated} localités mises à jour.`);
  console.log(`  ✗ ${rows.length - updated} localités sans résultat.`);
}

// ─── output ─────────────────────────────────────────────────────────────────

function writeMissingFile() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(missing, null, 2), 'utf8');
  console.log(`\n📄 Fichier des manquants : ${OUTPUT_FILE}`);
  console.log(`   communes manquantes  : ${missing.communes.length}`);
  console.log(`   localités manquantes : ${missing.localites.length}`);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       geocode_locations.js               ║');
  console.log('║  Nominatim geocoding — Sénégal           ║');
  console.log('╚══════════════════════════════════════════╝');

  const client = await pool.connect();
  try {
    await geocodeCommunes(client);
    await geocodeLocalites(client);
    writeMissingFile();
    console.log('\n✅ Géocodage terminé.');
  } catch (err) {
    console.error('\n❌ Erreur fatale :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
