/**
 * Reconstruction complète de la table localites depuis senegal.ts
 *
 * Étape 1 — Insérer les 25 515 localités depuis senegal.ts (coords NULL)
 * Étape 2 — Normalisation des noms (accents, tirets, apostrophes)
 * Étape 3 — Import coordonnées depuis SN.txt (feature_class=P) → source "sn_txt"
 * Étape 4 — Charger communes.json (centres communes pour filtrage étape 6)
 * Étape 5 — Import localites.geojson (place=village|hamlet|neighbourhood|suburb|quarter, avec name) → source "osm_geojson"
 * Étape 6 — Points GeoJSON sans name, skip si proche centre commune → source "osm_geojson_estimated"
 * Étape 7 — Distribution spatiale : points uniques dans le polygone commune → source "commune_polygon_random"
 */

const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const BATCH_SIZE = 500;
const COMMUNE_CENTER_THRESHOLD_KM = 0.5; // 500m

// ──────────────────────────── Helpers ────────────────────────────

function normalize(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseSenegalTs(filePath) {
  let raw = fs.readFileSync(filePath, 'utf-8');
  raw = raw.replace(/^export\s+const\s+senegal\s*=\s*/, '');
  raw = raw.replace(/;\s*$/, '');
  raw = raw.replace(/(\s)(name|code|lat|lon|elevation|departements|communes|localites)\s*:/g, '$1"$2":');
  raw = raw.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(raw);
}

const VALID_PLACE_TYPES = new Set(['village', 'hamlet', 'neighbourhood', 'suburb', 'quarter']);
const VALID_FEATURE_CODES = new Set(['PPL', 'PPLX', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4']);

// ──────────────────────────── Main ────────────────────────────

async function main() {
  const client = await pool.connect();
  const report = {};

  try {
    // ================================================================
    // ÉTAPE 1 — Insérer toutes les localités depuis senegal.ts
    // ================================================================
    console.log('\n=== ÉTAPE 1 : Insertion des localités depuis senegal.ts ===');

    const tsPath = path.resolve(__dirname, '..', '..', 'senegal.ts');
    const regions = parseSenegalTs(tsPath);

    // Charger les communes depuis la base
    const communesDb = await client.query(`
      SELECT c.commune_id, c.departement_id, c.name AS commune_name,
             d.region_id, d.name AS dept_name
      FROM communes_boundaries c
      JOIN departements_boundaries d ON d.departement_id = c.departement_id
    `);

    // Index: normCommune|normDept → { commune_id, departement_id, region_id }
    const communeIndex = new Map();
    for (const row of communesDb.rows) {
      const key = normalize(row.commune_name) + '|' + normalize(row.dept_name);
      communeIndex.set(key, {
        commune_id: row.commune_id,
        departement_id: row.departement_id,
        region_id: row.region_id,
      });
    }
    // Fallback par nom seul
    const communeByName = new Map();
    for (const row of communesDb.rows) {
      const key = normalize(row.commune_name);
      if (!communeByName.has(key)) {
        communeByName.set(key, {
          commune_id: row.commune_id,
          departement_id: row.departement_id,
          region_id: row.region_id,
        });
      }
    }

    // Extraire toutes les localités
    const allLocalites = [];
    for (const region of regions) {
      for (const dept of region.departements || []) {
        for (const commune of dept.communes || []) {
          const key = normalize(commune.name) + '|' + normalize(dept.name);
          const match = communeIndex.get(key) || communeByName.get(normalize(commune.name));
          for (const loc of commune.localites || []) {
            allLocalites.push({
              name: loc.name,
              commune_id: match ? match.commune_id : null,
              departement_id: match ? match.departement_id : null,
              region_id: match ? match.region_id : null,
            });
          }
        }
      }
    }

    report.totalSenegalTs = allLocalites.length;
    console.log(`  Localités extraites : ${allLocalites.length}`);

    // Drop + recreate table
    await client.query('DROP TABLE IF EXISTS localites CASCADE');
    await client.query(`
      CREATE TABLE localites (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        commune_id INTEGER,
        departement_id INTEGER,
        region_id INTEGER,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        source TEXT
      )
    `);

    for (let i = 0; i < allLocalites.length; i += BATCH_SIZE) {
      const batch = allLocalites.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');
      for (const loc of batch) {
        await client.query(
          `INSERT INTO localites (name, commune_id, departement_id, region_id)
           VALUES ($1, $2, $3, $4)`,
          [loc.name, loc.commune_id, loc.departement_id, loc.region_id]
        );
      }
      await client.query('COMMIT');
      process.stdout.write(`\r  Insérées : ${Math.min(i + BATCH_SIZE, allLocalites.length)}/${allLocalites.length}`);
    }

    const countCheck = await client.query('SELECT COUNT(*) AS c FROM localites');
    console.log(`\n  ✓ Table localites : ${countCheck.rows[0].c} lignes`);

    // ================================================================
    // ÉTAPE 2 — Normalisation (affichage info)
    // ================================================================
    console.log('\n=== ÉTAPE 2 : Normalisation des noms ===');
    console.log('  Méthode : suppression accents, tirets→espaces, ponctuation, espaces multiples');
    console.log('  Fonction normalize() appliquée à toutes les comparaisons');

    // ================================================================
    // ÉTAPE 3 — Import coordonnées depuis SN.txt (feature_class=P)
    // ================================================================
    console.log('\n=== ÉTAPE 3 : Coordonnées depuis SN.txt (feature_class=P) ===');

    const snPath = path.resolve(__dirname, '..', '..', 'SN.txt');
    const snRaw = fs.readFileSync(snPath, 'utf-8');
    const snLines = snRaw.split('\n').filter(l => l.trim());

    report.snLinesRead = snLines.length;
    console.log(`  Lignes totales dans SN.txt : ${snLines.length}`);

    // Construire index SN.txt filtré par feature_class=P
    const snIndex = new Map();
    let snFilteredCount = 0;
    for (const line of snLines) {
      const cols = line.split('\t');
      if (cols.length < 8) continue;

      const featureClass = cols[6];
      const featureCode = cols[7];

      // Filtrer : feature_class = P et codes PPL*
      if (featureClass !== 'P') continue;
      if (!VALID_FEATURE_CODES.has(featureCode)) continue;

      snFilteredCount++;
      const lat = parseFloat(cols[4]);
      const lng = parseFloat(cols[5]);
      if (isNaN(lat) || isNaN(lng)) continue;

      const mainName = normalize(cols[1]);
      if (mainName && !snIndex.has(mainName)) {
        snIndex.set(mainName, { lat, lng });
      }

      // Noms alternatifs (colonne 3)
      if (cols[3]) {
        for (const alt of cols[3].split(',')) {
          const normAlt = normalize(alt);
          if (normAlt && !snIndex.has(normAlt)) {
            snIndex.set(normAlt, { lat, lng });
          }
        }
      }
    }

    console.log(`  Lignes feature_class=P : ${snFilteredCount}`);
    console.log(`  Noms indexés : ${snIndex.size}`);

    // Charger toutes les localités sans coordonnées
    const allLocs = await client.query('SELECT id, name FROM localites WHERE latitude IS NULL');

    let snMatched = 0;
    for (let i = 0; i < allLocs.rows.length; i += BATCH_SIZE) {
      const batch = allLocs.rows.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');
      for (const loc of batch) {
        const coords = snIndex.get(normalize(loc.name));
        if (coords) {
          await client.query(
            `UPDATE localites SET latitude = $1, longitude = $2, source = 'sn_txt' WHERE id = $3`,
            [coords.lat, coords.lng, loc.id]
          );
          snMatched++;
        }
      }
      await client.query('COMMIT');
    }

    report.snMatched = snMatched;
    console.log(`  ✓ Localités matchées via SN.txt : ${snMatched}`);

    // ================================================================
    // ÉTAPE 4 — Charger communes.json (centres communes)
    // ================================================================
    console.log('\n=== ÉTAPE 4 : Chargement communes.json (centres communes) ===');

    const communesJsonPath = path.resolve(__dirname, '..', '..', 'communes.json');
    let communeCenters = new Map();

    if (fs.existsSync(communesJsonPath)) {
      const communesJson = JSON.parse(fs.readFileSync(communesJsonPath, 'utf-8'));
      for (const c of communesJson) {
        if (c.lat != null && c.lon != null) {
          const normName = normalize(c.name);
          communeCenters.set(normName, { lat: c.lat, lng: c.lon });
          // Aussi indexer par commune_id via communes_boundaries
          const dbMatch = communeByName.get(normName);
          if (dbMatch) {
            communeCenters.set(`cid:${dbMatch.commune_id}`, { lat: c.lat, lng: c.lon });
          }
        }
      }
      console.log(`  Centres de communes chargés : ${communeCenters.size / 2}`);
    } else {
      console.log('  ⚠ communes.json non trouvé, étape 6 ne filtrera pas les centres');
    }

    // ================================================================
    // ÉTAPE 5 — Import localites.geojson (place types filtrés, AVEC name)
    // ================================================================
    console.log('\n=== ÉTAPE 5 : Coordonnées depuis localites.geojson (avec name) ===');

    const gjPath = path.resolve(__dirname, '..', '..', 'localites.geojson');
    const geojson = JSON.parse(fs.readFileSync(gjPath, 'utf-8'));

    const withName = [];
    const withoutName = [];
    let filteredOut = 0;

    for (const f of geojson.features) {
      if (!f.geometry || f.geometry.type !== 'Point' || !f.geometry.coordinates) continue;
      const place = f.properties && f.properties.place;
      if (!place || !VALID_PLACE_TYPES.has(place)) {
        filteredOut++;
        continue;
      }

      if (f.properties.name) {
        withName.push(f);
      } else {
        withoutName.push(f);
      }
    }

    console.log(`  Features filtrées (place type invalide) : ${filteredOut}`);
    console.log(`  Features valides avec name : ${withName.length}`);
    console.log(`  Features valides sans name : ${withoutName.length}`);

    // Construire index GeoJSON : normName → { lat, lng }
    const gjIndex = new Map();
    for (const f of withName) {
      const norm = normalize(f.properties.name);
      const [lng, lat] = f.geometry.coordinates;
      if (norm && !gjIndex.has(norm)) {
        gjIndex.set(norm, { lat, lng });
      }
    }

    // Charger localités encore sans coordonnées
    const stillNull = await client.query('SELECT id, name FROM localites WHERE latitude IS NULL');

    let gjMatched = 0;
    for (let i = 0; i < stillNull.rows.length; i += BATCH_SIZE) {
      const batch = stillNull.rows.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');
      for (const loc of batch) {
        const coords = gjIndex.get(normalize(loc.name));
        if (coords) {
          await client.query(
            `UPDATE localites SET latitude = $1, longitude = $2, source = 'osm_geojson' WHERE id = $3`,
            [coords.lat, coords.lng, loc.id]
          );
          gjMatched++;
        }
      }
      await client.query('COMMIT');
    }

    report.gjMatched = gjMatched;
    console.log(`  ✓ Localités matchées via GeoJSON : ${gjMatched}`);

    // ================================================================
    // ÉTAPE 6 — Points GeoJSON sans name → estimation par commune
    //           (skip si proche du centre commune)
    // ================================================================
    console.log('\n=== ÉTAPE 6 : Points GeoJSON sans name → estimation par commune ===');

    report.gjNoName = withoutName.length;
    let estimated = 0;
    let skippedCenter = 0;

    for (let i = 0; i < withoutName.length; i++) {
      const f = withoutName[i];
      const [lng, lat] = f.geometry.coordinates;

      // Trouver la commune de ce point
      const communeResult = await client.query(
        `SELECT commune_id FROM communes_boundaries
         WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         LIMIT 1`,
        [lng, lat]
      );

      if (communeResult.rows.length === 0) continue;
      const communeId = communeResult.rows[0].commune_id;

      // Vérifier si ce point est proche du centre de la commune
      const center = communeCenters.get(`cid:${communeId}`);
      if (center) {
        const dist = haversineKm(lat, lng, center.lat, center.lng);
        if (dist < COMMUNE_CENTER_THRESHOLD_KM) {
          skippedCenter++;
          continue; // Ce point représente probablement la commune elle-même
        }
      }

      // Trouver UNE localité sans coordonnées dans cette commune
      const unmatched = await client.query(
        `SELECT id FROM localites
         WHERE commune_id = $1 AND latitude IS NULL
         LIMIT 1`,
        [communeId]
      );

      if (unmatched.rows.length === 0) continue;

      await client.query(
        `UPDATE localites SET latitude = $1, longitude = $2, source = 'osm_geojson_estimated' WHERE id = $3`,
        [lat, lng, unmatched.rows[0].id]
      );
      estimated++;

      if ((i + 1) % 500 === 0) {
        process.stdout.write(`\r  Traités : ${i + 1}/${withoutName.length}`);
      }
    }

    report.gjEstimated = estimated;
    report.skippedCenter = skippedCenter;
    console.log(`\r  Points skippés (proche centre commune) : ${skippedCenter}`);
    console.log(`  ✓ Localités estimées via points sans name : ${estimated}`);

    // ================================================================
    // ÉTAPE 7 — Distribution spatiale dans le polygone commune
    //           (points uniques via ST_GeneratePoints)
    // ================================================================
    console.log('\n=== ÉTAPE 7 : Distribution spatiale dans les communes ===');

    // Regrouper les localités restantes par commune
    const remaining = await client.query(
      `SELECT id, commune_id FROM localites
       WHERE latitude IS NULL AND commune_id IS NOT NULL
       ORDER BY commune_id`
    );

    console.log(`  Localités restantes sans coordonnées : ${remaining.rows.length}`);

    // Regrouper par commune_id
    const byCommune = new Map();
    for (const row of remaining.rows) {
      if (!byCommune.has(row.commune_id)) {
        byCommune.set(row.commune_id, []);
      }
      byCommune.get(row.commune_id).push(row.id);
    }

    let randomCount = 0;
    for (const [communeId, locIds] of byCommune) {
      // Générer N points uniques dans le polygone de la commune
      const pointsResult = await client.query(
        `SELECT
           ST_Y((dp).geom) AS latitude,
           ST_X((dp).geom) AS longitude
         FROM (
           SELECT ST_DumpPoints(ST_GeneratePoints(geometry, $1)) AS dp
           FROM communes_boundaries
           WHERE commune_id = $2
         ) sub`,
        [locIds.length, communeId]
      );

      await client.query('BEGIN');
      for (let j = 0; j < locIds.length; j++) {
        if (j < pointsResult.rows.length) {
          const pt = pointsResult.rows[j];
          await client.query(
            `UPDATE localites SET latitude = $1, longitude = $2, source = 'commune_polygon_random' WHERE id = $3`,
            [pt.latitude, pt.longitude, locIds[j]]
          );
        } else {
          // Fallback si ST_GeneratePoints n'a pas produit assez de points
          const fallback = await client.query(
            `SELECT
               ST_Y(ST_PointOnSurface(geometry)) + (random() - 0.5) * 0.005 AS latitude,
               ST_X(ST_PointOnSurface(geometry)) + (random() - 0.5) * 0.005 AS longitude
             FROM communes_boundaries WHERE commune_id = $1`,
            [communeId]
          );
          if (fallback.rows.length > 0) {
            await client.query(
              `UPDATE localites SET latitude = $1, longitude = $2, source = 'commune_polygon_random' WHERE id = $3`,
              [fallback.rows[0].latitude, fallback.rows[0].longitude, locIds[j]]
            );
          }
        }
        randomCount++;
      }
      await client.query('COMMIT');
    }

    report.randomCount = randomCount;
    console.log(`  ✓ Localités avec coordonnées aléatoires dans commune : ${randomCount}`);

    // ================================================================
    // Créer les index
    // ================================================================
    console.log('\n  Création des index...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_localites_commune_id ON localites (commune_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_localites_departement_id ON localites (departement_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_localites_region_id ON localites (region_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_localites_name ON localites (name)');
    console.log('  ✓ Index créés');

    // ================================================================
    // RAPPORT FINAL
    // ================================================================
    const stats = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(commune_id) AS with_commune,
        COUNT(latitude) AS with_coords,
        COUNT(*) FILTER (WHERE latitude IS NULL) AS no_coords,
        COUNT(*) FILTER (WHERE source = 'sn_txt') AS src_sn,
        COUNT(*) FILTER (WHERE source = 'osm_geojson') AS src_gj,
        COUNT(*) FILTER (WHERE source = 'osm_geojson_estimated') AS src_gj_est,
        COUNT(*) FILTER (WHERE source = 'commune_polygon_random') AS src_random
      FROM localites
    `);
    const s = stats.rows[0];

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                    RAPPORT FINAL                      ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Localités insérées (senegal.ts)      : ${String(report.totalSenegalTs).padStart(10)} ║`);
    console.log(`║  Lignes lues dans SN.txt              : ${String(report.snLinesRead).padStart(10)} ║`);
    console.log(`║  Matchées via SN.txt (class=P)        : ${String(s.src_sn).padStart(10)} ║`);
    console.log(`║  Matchées via GeoJSON (avec name)     : ${String(s.src_gj).padStart(10)} ║`);
    console.log(`║  Points GeoJSON sans name             : ${String(report.gjNoName).padStart(10)} ║`);
    console.log(`║  Skippés (proche centre commune)      : ${String(report.skippedCenter).padStart(10)} ║`);
    console.log(`║  Estimées via GeoJSON (sans name)     : ${String(s.src_gj_est).padStart(10)} ║`);
    console.log(`║  Distribution aléatoire dans commune  : ${String(s.src_random).padStart(10)} ║`);
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  TOTAL avec coordonnées               : ${String(s.with_coords).padStart(10)} ║`);
    console.log(`║  TOTAL sans coordonnées               : ${String(s.no_coords).padStart(10)} ║`);
    console.log(`║  TOTAL localités                      : ${String(s.total).padStart(10)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝');

    // Stats par région
    const byRegion = await client.query(`
      SELECT r.name AS region, COUNT(l.id) AS count
      FROM localites l
      JOIN regions_boundaries r ON r.region_id = l.region_id
      GROUP BY r.name ORDER BY count DESC
    `);
    console.log('\n  Par région :');
    for (const row of byRegion.rows) {
      console.log(`    ${row.region.padEnd(20)} ${row.count}`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
