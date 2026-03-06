/**
 * download-ansd-csv.js
 *
 * 1. Télécharge les 46 pages HTML ANSD (recensement 2023 par département)
 * 2. Extrait les liens "Download CSV" depuis chaque page
 * 3. Télécharge les fichiers CSV dans ./data/ansd-csv/
 *
 * Usage : node src/scripts/download-ansd-csv.js
 *
 * Les CSV produits seront ensuite parsés par import-population.js
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const BASE_URL  = 'https://www.ansd.sn/donnees-recensements';
const OUT_DIR   = path.resolve(__dirname, '../../data/ansd-csv');
const HTML_DIR  = path.join(OUT_DIR, 'html');

const DEPARTEMENTS = [
  { region: 'DAKAR',        dep: 'DAKAR' },
  { region: 'DAKAR',        dep: 'PIKINE' },
  { region: 'DAKAR',        dep: 'GUEDIAWAYE' },
  { region: 'DAKAR',        dep: 'RUFISQUE' },
  { region: 'DAKAR',        dep: 'KEUR MASSAR' },
  { region: 'DIOURBEL',     dep: 'DIOURBEL' },
  { region: 'DIOURBEL',     dep: 'BAMBEY' },
  { region: 'DIOURBEL',     dep: 'MBACKE' },
  { region: 'FATICK',       dep: 'FATICK' },
  { region: 'FATICK',       dep: 'FOUNDIOUGNE' },
  { region: 'FATICK',       dep: 'GOSSAS' },
  { region: 'KAFFRINE',     dep: 'KAFFRINE' },
  { region: 'KAFFRINE',     dep: 'BIRKELANE' },
  { region: 'KAFFRINE',     dep: 'KOUNGHEUL' },
  { region: 'KAFFRINE',     dep: 'MALEM HODAR' },
  { region: 'KAOLACK',      dep: 'KAOLACK' },
  { region: 'KAOLACK',      dep: 'NIORO DU RIP' },
  { region: 'KAOLACK',      dep: 'GUINGUINEO' },
  { region: 'KEDOUGOU',     dep: 'KEDOUGOU' },
  { region: 'KEDOUGOU',     dep: 'SALEMATA' },
  { region: 'KEDOUGOU',     dep: 'SARAYA' },
  { region: 'KOLDA',        dep: 'KOLDA' },
  { region: 'KOLDA',        dep: 'MEDINA YORO FOULAH' },
  { region: 'KOLDA',        dep: 'VELINGARA' },
  { region: 'LOUGA',        dep: 'LOUGA' },
  { region: 'LOUGA',        dep: 'LINGUERE' },
  { region: 'LOUGA',        dep: 'KEBEMER' },
  { region: 'MATAM',        dep: 'MATAM' },
  { region: 'MATAM',        dep: 'KANEL' },
  { region: 'MATAM',        dep: 'RANEROU FERLO' },
  { region: 'SAINT-LOUIS',  dep: 'SAINT LOUIS' },
  { region: 'SAINT-LOUIS',  dep: 'DAGANA' },
  { region: 'SAINT-LOUIS',  dep: 'PODOR' },
  { region: 'SEDHIOU',      dep: 'SEDHIOU' },
  { region: 'SEDHIOU',      dep: 'BOUNKILING' },
  { region: 'SEDHIOU',      dep: 'GOUDOMP' },
  { region: 'TAMBACOUNDA',  dep: 'TAMBACOUNDA' },
  { region: 'TAMBACOUNDA',  dep: 'BAKEL' },
  { region: 'TAMBACOUNDA',  dep: 'GOUDIRY' },
  { region: 'TAMBACOUNDA',  dep: 'KOUMPENTOUM' },
  { region: 'THIES',        dep: 'THIES' },
  { region: 'THIES',        dep: 'MBOUR' },
  { region: 'THIES',        dep: 'TIVAOUANE' },
  { region: 'ZIGUINCHOR',   dep: 'ZIGUINCHOR' },
  { region: 'ZIGUINCHOR',   dep: 'BIGNONA' },
  { region: 'ZIGUINCHOR',   dep: 'OUSSOUYE' },
];

// ─── Helpers ────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; frontieres-api-bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      timeout: 30000,
    }, (res) => {
      // Suivre les redirections
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function extractCsvLinks(html, baseUrl) {
  const links = [];
  // Cherche href contenant .csv ou /download ou export
  const patterns = [
    /href="([^"]*\.csv[^"]*)"/gi,
    /href="([^"]*\/download[^"]*)"/gi,
    /href="([^"]*export[^"]*)"/gi,
    /href="([^"]*\/sites\/default\/files\/[^"]*\.csv[^"]*)"/gi,
  ];

  const seen = new Set();
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      let href = m[1];
      if (!href.startsWith('http')) {
        const base = new URL(baseUrl);
        href = href.startsWith('/') ? `${base.protocol}//${base.host}${href}` : `${baseUrl}/${href}`;
      }
      if (!seen.has(href)) {
        seen.add(href);
        links.push(href);
      }
    }
  }
  return links;
}

// ─── Étape 1 : Télécharger les pages HTML ───────────────────────

async function downloadHtmlPages() {
  fs.mkdirSync(HTML_DIR, { recursive: true });
  console.log(`\n=== Étape 1 : Téléchargement des pages HTML (${DEPARTEMENTS.length} départements) ===`);

  let saved = 0, skipped = 0, errors = 0;

  for (let i = 0; i < DEPARTEMENTS.length; i++) {
    const { region, dep } = DEPARTEMENTS[i];
    const slug = slugify(dep);
    const htmlFile = path.join(HTML_DIR, `${slug}.html`);

    if (fs.existsSync(htmlFile)) {
      console.log(`  [${i+1}/${DEPARTEMENTS.length}] ↷ ${dep} (déjà téléchargé)`);
      skipped++;
      continue;
    }

    const url = `${BASE_URL}?field_liste_annee_value=2023` +
                `&field_regions_value=${encodeURIComponent(region)}` +
                `&field_departements_value=${encodeURIComponent(dep)}`;

    try {
      const buf = await fetchUrl(url);
      fs.writeFileSync(htmlFile, buf);
      console.log(`  [${i+1}/${DEPARTEMENTS.length}] ✓ ${dep} (${(buf.length/1024).toFixed(1)} KB)`);
      saved++;
      await sleep(800); // politesse envers le serveur
    } catch (err) {
      console.error(`  [${i+1}/${DEPARTEMENTS.length}] ✗ ${dep} : ${err.message}`);
      errors++;
      await sleep(1500);
    }
  }

  console.log(`\n  Pages HTML : ${saved} nouvelles, ${skipped} déjà présentes, ${errors} erreurs`);
  return errors;
}

// ─── Étape 2 : Extraire et télécharger les CSV ──────────────────

async function downloadCsvFiles() {
  console.log('\n=== Étape 2 : Extraction + téléchargement des CSV ===');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = {};
  let csvSaved = 0, csvErrors = 0, noLink = 0;

  for (let i = 0; i < DEPARTEMENTS.length; i++) {
    const { dep } = DEPARTEMENTS[i];
    const slug = slugify(dep);
    const htmlFile = path.join(HTML_DIR, `${slug}.html`);
    const csvFile  = path.join(OUT_DIR, `${slug}.csv`);

    if (!fs.existsSync(htmlFile)) {
      console.log(`  [${i+1}/${DEPARTEMENTS.length}] ⚠ HTML manquant : ${dep}`);
      noLink++;
      continue;
    }

    if (fs.existsSync(csvFile)) {
      console.log(`  [${i+1}/${DEPARTEMENTS.length}] ↷ ${dep} CSV déjà présent`);
      manifest[slug] = csvFile;
      csvSaved++;
      continue;
    }

    const html = fs.readFileSync(htmlFile, 'utf8');
    const pageUrl = `${BASE_URL}?field_liste_annee_value=2023&field_departements_value=${encodeURIComponent(dep)}`;
    const links = extractCsvLinks(html, pageUrl);

    if (links.length === 0) {
      console.log(`  [${i+1}/${DEPARTEMENTS.length}] ⚠ Aucun lien CSV trouvé : ${dep}`);
      noLink++;
      // Sauvegarder le HTML pour inspection manuelle
      continue;
    }

    // Prendre le premier lien CSV trouvé
    const csvUrl = links[0];
    try {
      const buf = await fetchUrl(csvUrl);
      fs.writeFileSync(csvFile, buf);
      manifest[slug] = csvFile;
      console.log(`  [${i+1}/${DEPARTEMENTS.length}] ✓ ${dep} → ${path.basename(csvFile)} (${(buf.length/1024).toFixed(1)} KB)`);
      csvSaved++;
      await sleep(600);
    } catch (err) {
      console.error(`  [${i+1}/${DEPARTEMENTS.length}] ✗ ${dep} CSV : ${err.message}`);
      csvErrors++;
    }
  }

  // Écrire le manifeste
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`\n  CSV : ${csvSaved} présents, ${noLink} sans lien, ${csvErrors} erreurs`);
  console.log(`  Manifeste écrit : ${path.join(OUT_DIR, 'manifest.json')}`);
  return { csvSaved, noLink, csvErrors };
}

// ─── Étape 3 : Rapport sur les CSV disponibles ──────────────────

function reportCsvFiles() {
  console.log('\n=== Rapport CSV disponibles ===');
  const csvFiles = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.csv'));
  console.log(`  ${csvFiles.length} fichiers CSV dans ${OUT_DIR}`);
  for (const f of csvFiles) {
    const size = fs.statSync(path.join(OUT_DIR, f)).size;
    console.log(`    ${f.padEnd(35)} ${(size/1024).toFixed(1)} KB`);
  }

  if (csvFiles.length === 0) {
    console.log('\n  ⚠ Aucun CSV téléchargé automatiquement.');
    console.log('  Le site ANSD peut nécessiter une session navigateur ou un CAPTCHA.');
    console.log('  → Placez manuellement les CSV dans : ' + OUT_DIR);
    console.log('  → Nommage attendu : <slug_departement>.csv (ex: dakar.csv, pikine.csv)');
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║        download-ansd-csv.js                      ║');
  console.log('║  Scraping recensement ANSD 2023 — 46 dpts        ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`\n  Dossier de sortie : ${OUT_DIR}\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(HTML_DIR, { recursive: true });

  await downloadHtmlPages();
  await downloadCsvFiles();
  reportCsvFiles();

  console.log('\n✅ Script terminé.');
  console.log('   Prochaine étape : node src/scripts/import-population.js');
}

main().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
