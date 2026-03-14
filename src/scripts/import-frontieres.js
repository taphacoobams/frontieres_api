/**
 * import-frontieres.js
 *
 * Analyse le fichier frontieres.geojson (Overpass Turbo) et extrait les
 * frontières administratives des communes (admin_level=8).
 * Fait le matching avec la base de données, applique des corrections
 * d'orthographe, et met à jour la colonne geometry.
 *
 * Produit :
 *   output/frontieres_completes.json   — entités matchées
 *   output/frontieres_manquantes.json  — entités DB sans frontière
 *
 * Usage: npm run import-frontieres
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('../database/connection');

const GEOJSON_FILE = path.join(__dirname, '../data/frontiere.geojson');
const OUTPUT_DIR   = path.join(__dirname, '../../output');
const ALLOW_PARTIAL_MATCH = process.env.ALLOW_PARTIAL_MATCH === 'true';

// ─── Normalisation ──────────────────────────────────────────────────────────

const PREFIXES = [
  'communauté rurale des ',
  'communaute rurale des ',
  'communauté rurale de ',
  'communaute rurale de ',
  'commune de ',
  'région de ',
  'region de ',
  'département de ',
  'departement de ',
];

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalize(name) {
  if (!name) return '';
  let n = name.trim().toLowerCase();
  // Handle œ/Œ ligature
  n = n.replace(/œ/g, 'oe').replace(/Œ/g, 'oe');
  for (const p of PREFIXES) {
    if (n.startsWith(p)) {
      n = n.slice(p.length);
      break;
    }
  }
  // Replace dashes, underscores, slashes, apostrophes with spaces
  n = n.replace(/[-_/'''`]/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

function normalizeNoAccent(name) {
  return stripAccents(normalize(name));
}

function parseCsvNames(value) {
  return (value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

const SKIP_UPDATE_FOR_COMMUNES = new Set(
  parseCsvNames(process.env.SKIP_UPDATE_FOR_COMMUNES).map(normalizeNoAccent)
);

// Corrections orthographiques connues : nom DB → variantes possibles dans OSM
const OSM_TO_DB = {
  'kaw': 'Djidah Thiaroye Kao',
  'peulh niaga': 'Tivaouane Peulh Niaga',
  'tivaoune peulh niaga': 'Tivaouane Peulh Niaga',
  'diamaguene sicap mbao': 'Diamaguène-Sicap Mbao',
  'patar': 'Patar',
  'dakateli': 'Dakateli',
  'darou mousty': 'Darou Mousty',
  'mbacke kadjor': 'Mbacké Kadjor',
  'affe djoloff': 'Affé Djoloff',
  'affe djoloff': 'Affé Djoloff',
  'thiamene pass': 'Thiamène Pass',
  'waounde': 'Waoundé',
  'sansamba': 'Sansamba',
  'sinthiou bocar ali': 'Sinthiou Bocar Ali',
  'kouthia gaydi': 'Kouthia Gaydi',
  'joal fadiouth': 'Joal-Fadiouth',
  'ndieyene sirah': 'Ndiéyène Sirah',
  'tassette': 'Tassette',
  'tenghory': 'Tenghory',
  'santhiaba manjacque': 'Santhiaba Manjacque',
  'nyassia': 'Nyassia',
  'diokoul mbelbouck': 'Diokoul Mbelbouck',
  'bandegne ouolof': 'Bandegne Ouolof',
  'paoskoto': 'Paoskoto',
  'pass koto': 'Paoskoto',
  'boutougou fara': 'Boutougou Fara',
  'm bour': 'Mbour',
  'mbour': 'Mbour',
  'thies nord': 'Thiès Nord',
  'thies est': 'Thiès Est',
  'thies ouest': 'Thiès Ouest',
  'rufisque nord': 'Rufisque Nord',
  'rufisque est': 'Rufisque Est',
  'rufisque ouest': 'Rufisque Ouest',
  'keur massar sud': 'Keur Massar Sud',
  'keur massar nord': 'Keur Massar Nord',
  'dahra djoloff': 'Dahra',
  // Corrections supplémentaires (OSM → DB)
  'madina diathbe': 'Madina Ndiathbé',
  'ndiathbe': 'Madina Ndiathbé',
  'bambylor': 'Bambilor',
  'yenne': 'Yène',
  'sebikhotane': 'Sébikotane',
  'mermoz sacre coeur': 'Mermoz Sacre Coeur',
  'ndiandane': 'Niandane',
  'malem hodar': 'Malem Hoddar',
  'diofior': 'Dioffior',
  'ndiob': 'Ndiop',
  'panal wolof': 'Panal Ouolof',
  'khelcom birane': 'Khelcom Birane',
  'khelcom': 'Khelcom Birane',
  'n doffane': 'Ndoffane',
  'ndoffane': 'Ndoffane',
  'keur madongo': 'Keur Mandongo',
  'agnams': 'Agnam Civol',
  'dembakane': 'Dembancane',
  'hamady ounare': 'Hamady Hounare',
  'tionk essil': 'Thionck Essyl',
  'meckhe': 'Mekhe',
  'patar sine': 'Patar',
  'patar lia': 'Patar',
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    Import frontières — GeoJSON → DB      ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // 1. Charger le GeoJSON
  console.log('Chargement du fichier GeoJSON…');
  const geojson = JSON.parse(fs.readFileSync(GEOJSON_FILE, 'utf8'));
  console.log(`  ${geojson.features.length} features au total.\n`);

  // 2. Charger les entités de la DB
  const client = await pool.connect();
  try {
    const { rows: dbCommunes } = await client.query(
      `SELECT c.id, c.name, d.name AS departement_name
       FROM communes c
       LEFT JOIN departements d ON d.id = c.departement_id
       ORDER BY c.id`
    );
    const { rows: dbDepts } = await client.query(
      'SELECT id, name FROM departements ORDER BY id'
    );
    const { rows: dbRegions } = await client.query(
      'SELECT id, name FROM regions ORDER BY id'
    );

    console.log(`  DB: ${dbRegions.length} régions, ${dbDepts.length} départements, ${dbCommunes.length} communes.\n`);

    // Construire des index de lookup par nom normalisé (sans accent)
    // Supporte les doublons : stocke un tableau d'entrées par clé
    function buildIndex(rows) {
      const idx = new Map();
      for (const r of rows) {
        const key = normalizeNoAccent(r.name);
        if (!idx.has(key)) idx.set(key, []);
        idx.get(key).push(r);
      }
      return idx;
    }

    // Récupérer la première entrée non encore matchée
    function getUnmatched(idx, key, matchedSet) {
      const entries = idx.get(key);
      if (!entries) return null;
      return entries.find(e => !matchedSet.has(e.id)) || null;
    }

    const communeIdx  = buildIndex(dbCommunes);
    const deptIdx     = buildIndex(dbDepts);
    const regionIdx   = buildIndex(dbRegions);

    // 3. Extraire les features par admin_level
    const features8 = geojson.features.filter(
      f => f.properties.admin_level === '8' && f.properties.name
           && f.geometry && f.geometry.coordinates && f.geometry.coordinates.length > 0
           && f.geometry.type !== 'LineString'  // Exclure les lignes (rivières etc.)
    );

    console.log(`  Features level 8 (communes) avec nom et polygone : ${features8.length}\n`);

    // 4. Matcher les communes
    console.log('=== Matching des communes ===\n');

    const matched    = [];
    const corrected  = [];
    const unmatched  = [];
    const dbMatched  = new Set();

    for (const f of features8) {
      const osmName = f.properties.name;
      const nKey    = normalizeNoAccent(osmName);

      // Essai 1 : match direct par nom normalisé
      let dbEntry = getUnmatched(communeIdx, nKey, dbMatched);
      let correction = null;
      let matchSource = dbEntry ? 'exact' : null;

      // Essai 2 : lookup dans la table de corrections
      if (!dbEntry) {
        const correctedName = OSM_TO_DB[normalize(osmName)] || OSM_TO_DB[nKey];
        if (correctedName) {
          const corrKey = normalizeNoAccent(correctedName);
          dbEntry = getUnmatched(communeIdx, corrKey, dbMatched);
          if (dbEntry) {
            correction = correctedName;
            matchSource = 'alias';
          }
        }
      }

      // Essai 3 : match partiel (le nom DB est contenu dans le nom OSM ou inversement)
      if (!dbEntry && ALLOW_PARTIAL_MATCH) {
        const partialCandidates = [];
        for (const [key, entries] of communeIdx) {
          const entry = entries.find(e => !dbMatched.has(e.id));
          if (!entry) continue;
          if ((nKey.includes(key) || key.includes(nKey)) && key.length >= 4 && nKey.length >= 4) {
            partialCandidates.push(entry);
          }
        }

        if (partialCandidates.length === 1) {
          dbEntry = partialCandidates[0];
          correction = `partial-unique: "${osmName}" ~ "${dbEntry.name}"`;
          matchSource = 'partial';
        } else if (partialCandidates.length > 1) {
          unmatched.push({
            osm_name: osmName,
            type: 'commune',
            reason: `match partiel ambigu (${partialCandidates.length} candidats)`,
            candidates: partialCandidates.slice(0, 5).map(c => ({ id: c.id, name: c.name })),
          });
          continue;
        }
      }

      if (dbEntry) {
        if (dbMatched.has(dbEntry.id)) continue;
        dbMatched.add(dbEntry.id);

        const geom = {
          type: f.geometry.type,
          coordinates: f.geometry.coordinates,
        };

        if (correction) {
          corrected.push({
            db_id:      dbEntry.id,
            db_name:    dbEntry.name,
            osm_name:   osmName,
            correction,
            match_source: matchSource,
            geometry:   geom,
          });
        } else {
          matched.push({
            db_id:    dbEntry.id,
            db_name:  dbEntry.name,
            osm_name: osmName,
            match_source: matchSource,
            geometry: geom,
          });
        }
      } else {
        unmatched.push({
          osm_name: osmName,
          type:     'commune',
          reason:   'aucune correspondance trouvée',
        });
      }
    }

    console.log(`  ✓ Match direct   : ${matched.length}`);
    console.log(`  ✓ Match corrigé  : ${corrected.length}`);
    console.log(`  ✗ Non matchés    : ${unmatched.length}\n`);

    // 5. Mettre à jour les geometries en DB
    console.log('=== Mise à jour des géométries en DB ===\n');

    const allMatched = [...matched, ...corrected];
    let updatedCount = 0;
    const skippedLocked = [];

    for (const m of allMatched) {
      if (SKIP_UPDATE_FOR_COMMUNES.has(normalizeNoAccent(m.db_name))) {
        skippedLocked.push({ id: m.db_id, name: m.db_name, osm_name: m.osm_name });
        continue;
      }

      const geojsonStr = JSON.stringify(m.geometry);
      try {
        // Protection: on n'ecrase pas une geometrie existante pour un match incertain.
        if (m.match_source === 'partial') {
          await client.query(
            `UPDATE communes
             SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
             WHERE id = $2
               AND geometry IS NULL`,
            [geojsonStr, m.db_id]
          );
        } else {
          await client.query(
            `UPDATE communes
             SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
             WHERE id = $2`,
            [geojsonStr, m.db_id]
          );
        }
        updatedCount++;
      } catch (err) {
        console.log(`  ✗ Erreur géométrie [${m.db_id}] ${m.db_name}: ${err.message}`);
      }
    }

    console.log(`  ✓ ${updatedCount}/${allMatched.length} géométries de communes mises à jour.\n`);
    if (skippedLocked.length > 0) {
      console.log(`  ⚠ ${skippedLocked.length} commune(s) protégée(s), non mises à jour :`);
      for (const c of skippedLocked) {
        console.log(`    [${c.id}] ${c.name} (source OSM: ${c.osm_name})`);
      }
      console.log('');
    }

    // 6. Communes DB sans frontière
    const communesMissing = dbCommunes.filter(c => !dbMatched.has(c.id));
    const podorMissing = communesMissing.filter(c => normalizeNoAccent(c.departement_name || '') === 'podor');
    if (communesMissing.length > 0) {
      console.log(`  ⚠ ${communesMissing.length} communes DB sans frontière dans le GeoJSON :`);
      for (const c of communesMissing) {
        console.log(`    [${c.id}] ${c.name}`);
      }
    } else {
      console.log('  ✓ Toutes les communes DB ont une frontière !');
    }

    if (podorMissing.length > 0) {
      console.log(`\n  ⚠ Podor: ${podorMissing.length} commune(s) sans correspondance source`);
      for (const c of podorMissing) {
        console.log(`    [${c.id}] ${c.name}`);
      }
    } else {
      console.log('\n  ✓ Podor: toutes les communes ont une correspondance.');
    }

    // 7. Régions (admin_level 4)
    console.log('\n=== Matching des régions (admin_level 4) ===\n');
    const features4 = geojson.features.filter(
      f => f.properties.admin_level === '4' && f.properties.name
           && f.geometry && f.geometry.type !== 'LineString'
    );

    let regionsUpdated = 0;
    const regionsMatched = new Set();

    for (const f of features4) {
      const nKey = normalizeNoAccent(f.properties.name);
      const dbEntry = getUnmatched(regionIdx, nKey, regionsMatched);
      if (dbEntry) {
        regionsMatched.add(dbEntry.id);
        const geojsonStr = JSON.stringify(f.geometry);
        try {
          await client.query(
            `UPDATE regions SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) WHERE id = $2`,
            [geojsonStr, dbEntry.id]
          );
          regionsUpdated++;
          console.log(`  ✓ ${dbEntry.name}`);
        } catch (err) {
          console.log(`  ✗ Erreur [${dbEntry.id}] ${dbEntry.name}: ${err.message}`);
        }
      }
    }

    const regionsMissing = dbRegions.filter(r => !regionsMatched.has(r.id));
    console.log(`\n  ✓ ${regionsUpdated} régions mises à jour.`);
    if (regionsMissing.length > 0) {
      console.log(`  ⚠ ${regionsMissing.length} régions sans frontière :`);
      for (const r of regionsMissing) {
        console.log(`    [${r.id}] ${r.name}`);
      }
    }

    // 8. Écriture des rapports
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const completesReport = {
      communes_matched: matched.map(m => ({ id: m.db_id, name: m.db_name, osm_name: m.osm_name })),
      communes_corrected: corrected.map(m => ({ id: m.db_id, name: m.db_name, osm_name: m.osm_name, correction: m.correction })),
      matching_options: {
        allow_partial_match: ALLOW_PARTIAL_MATCH,
        skip_update_for_communes: parseCsvNames(process.env.SKIP_UPDATE_FOR_COMMUNES),
      },
      regions_matched: [...regionsMatched].length,
    };
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'frontieres_completes.json'),
      JSON.stringify(completesReport, null, 2), 'utf8'
    );

    const manquantesReport = {
      communes_sans_frontiere: communesMissing.map(c => ({ id: c.id, name: c.name })),
      communes_podor_sans_frontiere: podorMissing.map(c => ({ id: c.id, name: c.name })),
      communes_osm_non_matchees: unmatched,
      regions_sans_frontiere: regionsMissing.map(r => ({ id: r.id, name: r.name })),
    };
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'frontieres_manquantes.json'),
      JSON.stringify(manquantesReport, null, 2), 'utf8'
    );

    console.log('\n📄 Rapports écrits :');
    console.log(`   ${path.join(OUTPUT_DIR, 'frontieres_completes.json')}`);
    console.log(`   ${path.join(OUTPUT_DIR, 'frontieres_manquantes.json')}`);

    // Résumé final
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║           RÉSUMÉ FINAL                   ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`  Communes matchées       : ${matched.length + corrected.length}/${dbCommunes.length}`);
    console.log(`  Communes corrigées      : ${corrected.length}`);
    console.log(`  Communes DB manquantes  : ${communesMissing.length}`);
    console.log(`  Régions matchées        : ${regionsUpdated}/${dbRegions.length}`);
    console.log(`  Régions manquantes      : ${regionsMissing.length}`);

  } catch (err) {
    console.error('\n❌ Erreur fatale :', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
