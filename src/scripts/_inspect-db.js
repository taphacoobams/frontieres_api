const pool = require('../database/connection');

async function main() {
  const client = await pool.connect();

  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
  );
  console.log('=== TABLES ===');
  tables.rows.forEach(r => console.log(' ', r.table_name));

  for (const t of ['regions_boundaries', 'departements_boundaries', 'communes_boundaries', 'localites']) {
    const cols = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
      [t]
    );
    console.log('\n=== ' + t + ' ===');
    cols.rows.forEach(r => console.log('  ' + r.column_name + ' : ' + r.data_type));

    const cnt = await client.query('SELECT COUNT(*) FROM ' + t);
    console.log('  COUNT:', cnt.rows[0].count);
  }

  // Vérifier indexes spatiaux existants
  const idx = await client.query(
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%gist%' ORDER BY tablename`
  );
  console.log('\n=== INDEX GIST ===');
  idx.rows.forEach(r => console.log(' ', r.tablename, '-', r.indexname));

  // Départements : vérifier Pikine / Keur Massar
  const depts = await client.query(
    `SELECT id, name FROM departements_boundaries WHERE name ILIKE '%pikine%' OR name ILIKE '%keur massar%'`
  );
  console.log('\n=== PIKINE / KEUR MASSAR ===');
  depts.rows.forEach(r => console.log('  id=' + r.id + ' name=' + r.name));

  // Communes de Pikine et Keur Massar
  const communes = await client.query(
    `SELECT c.id, c.name, c.departement_id FROM communes_boundaries c
     WHERE c.departement_id IN (SELECT id FROM departements_boundaries WHERE name ILIKE '%pikine%' OR name ILIKE '%keur massar%')
     ORDER BY c.departement_id, c.name`
  );
  console.log('\n=== COMMUNES PIKINE/KEUR MASSAR ===');
  communes.rows.forEach(r => console.log('  dept_id=' + r.departement_id + ' id=' + r.id + ' name=' + r.name));

  client.release();
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
