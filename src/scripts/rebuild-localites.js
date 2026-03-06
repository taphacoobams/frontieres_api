/**
 * Reconstruction complète de localites_geo depuis senegal.ts
 *
 * Étape 1 — Insérer les 25 515 localités depuis senegal.ts (coords NULL)
 * Étape 2 — Géocoder via SN.txt           → source = "sn_txt"
 * Étape 3 — Géocoder via localites.geojson (avec name) → source = "osm_geojson"
 * Étape 4 — Points GeoJSON sans name       → source = "osm_geojson_estimated"
 * Étape 5 — Fallback centroïde commune     → source = "centroide_commune"
 */

const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const BATCH_SIZE = 500;

// ──────────────────────────── Helpers ────────────────────────────

function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_'/().]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSenegalTs(filePath) {
  let raw = fs.readFileSync(filePath, 'utf-8');
  raw = raw.replace(/^export\s+const\s+senegal\s*=\s*/, '');
  raw = raw.replace(/;\s*$/, '');
  raw = raw.replace(/(\s)(name|code|lat|lon|elevation|departements|communes|localites)\s*:/g, '$1"$2":');
  raw = raw.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(raw);
}

// ──────────────────────────── Main ────────────────────────────

async function main() {
  const client = await pool.connect();
  const report = {};

  try {
    // ================================================================
    // ÉTAPE 1 — Insérer toutes les localités depuis senegal.ts
    // ================================================================
    console.log('=== ÉTAPE 1 : Insertion des localités depuis senegal.ts ===');

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

    // TRUNCATE + INSERT
    await client.query('TRUNCATE localites_geo RESTART IDENTITY');

    for (let i = 0; i < allLocalites.length; i += BATCH_SIZE) {
      const batch = allLocalites.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');
      for (const loc of batch) {
        await client.query(
          `INSERT INTO localites_geo (name, commune_id, departement_id, region_id, latitude, longitude, source)
           VALUES ($1, $2, $3, $4, NULL, NULL, NULL)`,
          [loc.name, loc.commune_id, loc.departement_id, loc.region_id]
        );
      }
      await client.query('COMMIT');
      process.stdout.write(`\r  Insérées : ${Math.min(i + BATCH_SIZE, allLocalites.length)}/${allLocalites.length}`);
    }

    const countCheck = await client.query('SELECT COUNT(*) AS c FROM localites_geo');
    console.log(`\n  ✓ Table localites_geo : ${countCheck.rows[0].c} lignes\n`);

    // ================================================================
    // ÉTAPE 2 — Géocodage via SN.txt
    // ================================================================
    console.log('=== ÉTAPE 2 : Coordonnées depuis SN.txt ===');

    const snPath = path.resolve(__dirname, '..', '..', 'SN.txt');
    const snRaw = fs.readFileSync(snPath, 'utf-8');
    const snLines = snRaw.split('\n').filter(l => l.trim());

    report.snLinesRead = snLines.length;
    console.log(`  Lignes lues dans SN.txt : ${snLines.length}`);

    // Construire un index SN.txt : normName → { lat, lng } (première occurrence)
    const snIndex = new Map();
    for (const line of snLines) {
      const cols = line.split('\t');
      if (cols.length < 7) continue;
      const lat = parseFloat(cols[4]);
      const lng = parseFloat(cols[5]);
      if (isNaN(lat) || isNaN(lng)) continue;

      const mainName = normalize(cols[1]);
      if (mainName && !snIndex.has(mainName)) {
        snIndex.set(mainName, { lat, lng });
      }

      // Aussi indexer les noms alternatifs (colonne 3)
      if (cols[3]) {
        const alts = cols[3].split(',');
        for (const alt of alts) {
          const normAlt = normalize(alt);
          if (normAlt && !snIndex.has(normAlt)) {
            snIndex.set(normAlt, { lat, lng });
          }
        }
      }
    }

    console.log(`  Noms indexés (SN.txt) : ${snIndex.size}`);

    // Charger toutes les localités sans coordonnées
    const allLocs = await client.query(
      'SELECT id, name FROM localites_geo WHERE latitude IS NULL'
    );

    let snMatched = 0;
    for (let i = 0; i < allLocs.rows.length; i += BATCH_SIZE) {
      const batch = allLocs.rows.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');
      for (const loc of batch) {
        const norm = normalize(loc.name);
        const coords = snIndex.get(norm);
        if (coords) {
          await client.query(
            `UPDATE localites_geo SET latitude = $1, longitude = $2, source = 'sn_txt' WHERE id = $3`,
            [coords.lat, coords.lng, loc.id]
          );
          snMatched++;
        }
      }
      await client.query('COMMIT');
    }

    report.snMatched = snMatched;
    console.log(`  ✓ Localités matchées avec SN.txt : ${snMatched}\n`);

    // ================================================================
    // ÉTAPE 3 — Géocodage via localites.geojson (features AVEC name)
    // ================================================================
    console.log('=== ÉTAPE 3 : Coordonnées depuis localites.geojson (avec name) ===');

    const gjPath = path.resolve(__dirname, '..', '..', 'localites.geojson');
    const gjRaw = fs.readFileSync(gjPath, 'utf-8');
    const geojson = JSON.parse(gjRaw);

    const withName = [];
    const withoutName = [];

    for (const f of geojson.features) {
      if (!f.geometry || f.geometry.type !== 'Point' || !f.geometry.coordinates) continue;
      if (f.properties && f.properties.name) {
        withName.push(f);
      } else {
        withoutName.push(f);
      }
    }

    console.log(`  Features avec name    : ${withName.length}`);
    console.log(`  Features sans name    : ${withoutName.length}`);

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
    const stillNull = await client.query(
      'SELECT id, name FROM localites_geo WHERE latitude IS NULL'
    );

    let gjMatched = 0;
    for (let i = 0; i < stillNull.rows.length; i += BATCH_SIZE) {
      const batch = stillNull.rows.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');
      for (const loc of batch) {
        const norm = normalize(loc.name);
        const coords = gjIndex.get(norm);
        if (coords) {
          await client.query(
            `UPDATE localites_geo SET latitude = $1, longitude = $2, source = 'osm_geojson' WHERE id = $3`,
            [coords.lat, coords.lng, loc.id]
          );
          gjMatched++;
        }
      }
      await client.query('COMMIT');
    }

    report.gjMatched = gjMatched;
    console.log(`  ✓ Localités matchées avec GeoJSON : ${gjMatched}\n`);

    // ================================================================
    // ÉTAPE 4 — Points GeoJSON sans name → estimation par commune
    // ================================================================
    console.log('=== ÉTAPE 4 : Points GeoJSON sans name → estimation par commune ===');

    report.gjNoName = withoutName.length;
    let estimated = 0;

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

      // Trouver UNE localité sans coordonnées dans cette commune
      const unmatched = await client.query(
        `SELECT id FROM localites_geo
         WHERE commune_id = $1 AND latitude IS NULL
         LIMIT 1`,
        [communeId]
      );

      if (unmatched.rows.length === 0) continue;

      await client.query(
        `UPDATE localites_geo SET latitude = $1, longitude = $2, source = 'osm_geojson_estimated' WHERE id = $3`,
        [lat, lng, unmatched.rows[0].id]
      );
      estimated++;

      if ((i + 1) % 500 === 0) {
        process.stdout.write(`\r  Traités : ${i + 1}/${withoutName.length}`);
      }
    }

    report.gjEstimated = estimated;
    console.log(`\r  ✓ Localités estimées via points sans name : ${estimated}\n`);

    // ================================================================
    // ÉTAPE 5 — Fallback centroïde de la commune
    // ================================================================
    console.log('=== ÉTAPE 5 : Fallback centroïde commune ===');

    const remaining = await client.query(
      'SELECT id, commune_id FROM localites_geo WHERE latitude IS NULL AND commune_id IS NOT NULL'
    );

    console.log(`  Localités restantes sans coordonnées : ${remaining.rows.length}`);

    let centroidCount = 0;
    for (let i = 0; i < remaining.rows.length; i += BATCH_SIZE) {
      const batch = remaining.rows.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');
      for (const loc of batch) {
        const centroid = await client.query(
          `SELECT ST_Y(ST_Centroid(geometry)) AS latitude,
                  ST_X(ST_Centroid(geometry)) AS longitude
           FROM communes_boundaries WHERE commune_id = $1`,
          [loc.commune_id]
        );
        if (centroid.rows.length > 0) {
          await client.query(
            `UPDATE localites_geo SET latitude = $1, longitude = $2, source = 'centroide_commune' WHERE id = $3`,
            [centroid.rows[0].latitude, centroid.rows[0].longitude, loc.id]
          );
          centroidCount++;
        }
      }
      await client.query('COMMIT');
    }

    report.centroid = centroidCount;
    console.log(`  ✓ Localités avec centroïde : ${centroidCount}\n`);

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
        COUNT(*) FILTER (WHERE source = 'centroide_commune') AS src_centroid
      FROM localites_geo
    `);
    const s = stats.rows[0];

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║              RAPPORT FINAL                      ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Localités insérées (senegal.ts)  : ${String(report.totalSenegalTs).padStart(10)} ║`);
    console.log(`║  Lignes lues dans SN.txt          : ${String(report.snLinesRead).padStart(10)} ║`);
    console.log(`║  Matchées via SN.txt              : ${String(s.src_sn).padStart(10)} ║`);
    console.log(`║  Matchées via GeoJSON (avec name) : ${String(s.src_gj).padStart(10)} ║`);
    console.log(`║  Points GeoJSON sans name         : ${String(report.gjNoName).padStart(10)} ║`);
    console.log(`║  Estimées via GeoJSON (sans name) : ${String(s.src_gj_est).padStart(10)} ║`);
    console.log(`║  Fallback centroïde               : ${String(s.src_centroid).padStart(10)} ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  TOTAL avec coordonnées           : ${String(s.with_coords).padStart(10)} ║`);
    console.log(`║  TOTAL sans coordonnées           : ${String(s.no_coords).padStart(10)} ║`);
    console.log(`║  TOTAL localités                  : ${String(s.total).padStart(10)} ║`);
    console.log('╚══════════════════════════════════════════════════╝');

    // Stats par région
    const byRegion = await client.query(`
      SELECT r.name AS region, COUNT(l.id) AS count
      FROM localites_geo l
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
