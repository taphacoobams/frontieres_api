/**
 * Étape 1 : Met à jour les géométries des départements depuis sen_admin2.geojson (OCHA)
 *
 * - Remplace les polygones par ceux du dataset officiel OCHA
 * - Corrige la séparation Pikine / Keur Massar
 * - Met à jour lat, lon, superficie_km2 depuis les propriétés OCHA
 */

const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const ADMIN2_PATH = path.join(__dirname, '../../sen_admin_boundaries.geojson/sen_admin2.geojson');

// Correspondance nom OCHA → nom en base (normalisation)
function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Correspondance manuelle : nom_base_normalisé → nom_ocha_normalisé
const MANUAL_MAPPING = {
  'birkilane':           'birkelane',
  'malem hoddar':        'malem hodar',
  'medina yoro foulah':  'medina yorofoula',
  'nioro':               'nioro du rip',
  'ranerou ferlo':       'ranerou',
};

async function main() {
  const client = await pool.connect();

  try {
    // Ajouter colonnes lat, lon, superficie_km2 si absentes
    await client.query(`
      ALTER TABLE departements_boundaries
        ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS superficie_km2 DOUBLE PRECISION
    `);
    console.log('✓ Colonnes lat, lon, superficie_km2 présentes sur departements_boundaries');

    // Charger admin2.geojson
    const geojson = JSON.parse(fs.readFileSync(ADMIN2_PATH, 'utf8'));
    console.log(`\nFeatures admin2 chargées : ${geojson.features.length}`);

    // Charger tous les départements en base
    const { rows: depts } = await client.query(
      'SELECT id, name FROM departements_boundaries ORDER BY id'
    );
    console.log(`Départements en base : ${depts.length}`);

    // Construire index des features OCHA par nom normalisé
    const ochaByName = new Map();
    for (const feat of geojson.features) {
      const p = feat.properties;
      const key = normalizeName(p.adm2_name);
      ochaByName.set(key, feat);
    }

    let updated = 0;
    let notFound = [];

    await client.query('BEGIN');

    for (const dept of depts) {
      const key = normalizeName(dept.name);
      const mappedKey = MANUAL_MAPPING[key] || key;
      const feat = ochaByName.get(mappedKey);

      if (!feat) {
        notFound.push(dept.name);
        continue;
      }

      const p = feat.properties;
      const geomJson = JSON.stringify(feat.geometry);

      await client.query(`
        UPDATE departements_boundaries
        SET
          geometry     = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
          lat          = $2,
          lon          = $3,
          superficie_km2 = $4
        WHERE id = $5
      `, [geomJson, p.center_lat, p.center_lon, p.area_sqkm, dept.id]);

      updated++;
    }

    await client.query('COMMIT');

    console.log(`\n✓ Départements mis à jour : ${updated}/${depts.length}`);

    if (notFound.length > 0) {
      console.log(`\n⚠ Départements non trouvés dans OCHA (${notFound.length}) :`);
      notFound.forEach(n => console.log('  -', n));

      // Tentative de correspondance floue pour les non trouvés
      console.log('\n  Tentative de correspondance manuelle...');
      const manual = {
        'keur massar': 'Keur Massar',
        'pikine': 'Pikine',
      };
      // afficher les noms OCHA disponibles pour aide
      console.log('\n  Noms OCHA disponibles :');
      for (const [k] of ochaByName) console.log('   ', k);
    }

    // Recalcul superficie depuis géométrie PostGIS (pour les non-matchés OCHA)
    await client.query(`
      UPDATE departements_boundaries
      SET superficie_km2 = ST_Area(geometry::geography) / 1000000.0
      WHERE superficie_km2 IS NULL
    `);

    // Recalcul lat/lon depuis centroïde pour les non-matchés
    await client.query(`
      UPDATE departements_boundaries
      SET
        lat = ST_Y(ST_Centroid(geometry)),
        lon = ST_X(ST_Centroid(geometry))
      WHERE lat IS NULL OR lon IS NULL
    `);

    // Rapport
    const stats = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(lat) AS with_coords,
        COUNT(superficie_km2) AS with_area,
        ROUND(SUM(superficie_km2)::numeric, 0) AS total_area_km2
      FROM departements_boundaries
    `);
    const s = stats.rows[0];
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║       RAPPORT departements_boundaries         ║');
    console.log('╠════════════════════════════════════════════════╣');
    console.log(`║  Total départements          : ${String(s.total).padStart(10)} ║`);
    console.log(`║  Avec lat/lon                : ${String(s.with_coords).padStart(10)} ║`);
    console.log(`║  Avec superficie_km2         : ${String(s.with_area).padStart(10)} ║`);
    console.log(`║  Superficie totale (km2)     : ${String(s.total_area_km2).padStart(10)} ║`);
    console.log('╚════════════════════════════════════════════════╝');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nErreur :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
