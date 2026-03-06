/**
 * compute-densite.js
 *
 * 1. Propage la population des localités vers communes → departements → regions
 * 2. Calcule densite = population / superficie_km2 pour toutes les tables
 *
 * Usage : node src/scripts/compute-densite.js
 */

const pool = require('../database/connection');

async function main() {
  const client = await pool.connect();
  try {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║        compute-densite.js                        ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');

    await client.query('BEGIN');

    // ─────────────────────────────────────────────────────────────
    // S'assurer que les colonnes existent
    // ─────────────────────────────────────────────────────────────
    for (const tbl of ['regions', 'departements', 'communes', 'localites']) {
      await client.query(`
        ALTER TABLE ${tbl}
          ADD COLUMN IF NOT EXISTS population INTEGER,
          ADD COLUMN IF NOT EXISTS densite    DOUBLE PRECISION
      `);
    }

    // ─────────────────────────────────────────────────────────────
    // 1. Population des communes (somme des localités)
    // ─────────────────────────────────────────────────────────────
    console.log('=== 1. Population des communes ===');
    const { rowCount: rc1 } = await client.query(`
      UPDATE communes c
      SET population = sub.pop
      FROM (
        SELECT commune_id, SUM(population) AS pop
        FROM localites
        WHERE population IS NOT NULL AND commune_id IS NOT NULL
        GROUP BY commune_id
      ) sub
      WHERE c.id = sub.commune_id
    `);
    console.log(`  ✓ ${rc1} communes mises à jour`);

    // ─────────────────────────────────────────────────────────────
    // 2. Population des départements (somme des localités)
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 2. Population des départements ===');
    const { rowCount: rc2 } = await client.query(`
      UPDATE departements d
      SET population = sub.pop
      FROM (
        SELECT departement_id, SUM(population) AS pop
        FROM localites
        WHERE population IS NOT NULL AND departement_id IS NOT NULL
        GROUP BY departement_id
      ) sub
      WHERE d.id = sub.departement_id
    `);
    console.log(`  ✓ ${rc2} départements mis à jour`);

    // ─────────────────────────────────────────────────────────────
    // 3. Population des régions (somme des localités)
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 3. Population des régions ===');
    const { rowCount: rc3 } = await client.query(`
      UPDATE regions r
      SET population = sub.pop
      FROM (
        SELECT region_id, SUM(population) AS pop
        FROM localites
        WHERE population IS NOT NULL AND region_id IS NOT NULL
        GROUP BY region_id
      ) sub
      WHERE r.id = sub.region_id
    `);
    console.log(`  ✓ ${rc3} régions mises à jour`);

    // ─────────────────────────────────────────────────────────────
    // 4. Densité des localités
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 4. Densité des localités ===');
    const { rowCount: rc4 } = await client.query(`
      UPDATE localites
      SET densite = ROUND((population::numeric / NULLIF(superficie_km2, 0))::numeric, 2)
      WHERE population IS NOT NULL AND superficie_km2 IS NOT NULL AND superficie_km2 > 0
    `);
    console.log(`  ✓ ${rc4} localités — densite calculée`);

    // ─────────────────────────────────────────────────────────────
    // 5. Densité des communes
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 5. Densité des communes ===');
    const { rowCount: rc5 } = await client.query(`
      UPDATE communes
      SET densite = ROUND((population::numeric / NULLIF(superficie_km2, 0))::numeric, 2)
      WHERE population IS NOT NULL AND superficie_km2 IS NOT NULL AND superficie_km2 > 0
    `);
    console.log(`  ✓ ${rc5} communes — densite calculée`);

    // ─────────────────────────────────────────────────────────────
    // 6. Densité des départements
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 6. Densité des départements ===');
    const { rowCount: rc6 } = await client.query(`
      UPDATE departements
      SET densite = ROUND((population::numeric / NULLIF(superficie_km2, 0))::numeric, 2)
      WHERE population IS NOT NULL AND superficie_km2 IS NOT NULL AND superficie_km2 > 0
    `);
    console.log(`  ✓ ${rc6} départements — densite calculée`);

    // ─────────────────────────────────────────────────────────────
    // 7. Densité des régions
    // ─────────────────────────────────────────────────────────────
    console.log('\n=== 7. Densité des régions ===');
    const { rowCount: rc7 } = await client.query(`
      UPDATE regions
      SET densite = ROUND((population::numeric / NULLIF(superficie_km2, 0))::numeric, 2)
      WHERE population IS NOT NULL AND superficie_km2 IS NOT NULL AND superficie_km2 > 0
    `);
    console.log(`  ✓ ${rc7} régions — densite calculée`);

    await client.query('COMMIT');

    // ─────────────────────────────────────────────────────────────
    // RAPPORT FINAL
    // ─────────────────────────────────────────────────────────────
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║              RAPPORT compute-densite            ║');
    console.log('╠══════════════════════════════════════════════════╣');

    for (const tbl of ['regions', 'departements', 'communes', 'localites']) {
      const { rows: [s] } = await client.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(population) AS with_pop,
          COUNT(densite) AS with_densite,
          SUM(population) AS sum_pop
        FROM ${tbl}
      `);
      const label = tbl.padEnd(13);
      console.log(`║  ${label} total=${String(s.total).padStart(6)}  pop=${String(s.with_pop).padStart(6)}  densite=${String(s.with_densite).padStart(6)} ║`);
    }

    // Top 5 régions par population
    const { rows: topRegions } = await client.query(`
      SELECT name, population, densite
      FROM regions
      WHERE population IS NOT NULL
      ORDER BY population DESC
      LIMIT 5
    `);
    if (topRegions.length > 0) {
      console.log('╠══════════════════════════════════════════════════╣');
      console.log('║  Top 5 régions par population :                 ║');
      for (const r of topRegions) {
        const line = `${r.name} : ${r.population?.toLocaleString()} hab (${r.densite} hab/km²)`;
        console.log(`║    ${line.padEnd(46)} ║`);
      }
    }

    console.log('╚══════════════════════════════════════════════════╝');
    console.log('\n✅ Calcul terminé.');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Erreur :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
