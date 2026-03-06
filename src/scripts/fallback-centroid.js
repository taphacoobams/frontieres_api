/**
 * Fallback : assigner les localités sans commune à la commune la plus proche
 * en utilisant ST_Distance, puis pour celles qui n'ont toujours pas de commune,
 * utiliser le centroid de la commune la plus proche.
 */
const pool = require('../database/connection');

async function main() {
  const client = await pool.connect();

  try {
    // 1. Localités sans commune mais avec coordonnées
    const noCommune = await client.query(`
      SELECT id, name, latitude, longitude
      FROM localites_geo
      WHERE commune_id IS NULL AND latitude IS NOT NULL
    `);

    console.log(`Localités sans commune : ${noCommune.rows.length}`);

    let assigned = 0;

    for (const loc of noCommune.rows) {
      // Trouver la commune la plus proche par distance
      const result = await client.query(`
        SELECT 
          c.commune_id,
          c.departement_id,
          d.region_id
        FROM communes_boundaries c
        JOIN departements_boundaries d ON d.departement_id = c.departement_id
        ORDER BY c.geometry <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        LIMIT 1
      `, [loc.longitude, loc.latitude]);

      if (result.rows.length > 0) {
        const r = result.rows[0];
        await client.query(`
          UPDATE localites_geo
          SET commune_id = $1, departement_id = $2, region_id = $3
          WHERE id = $4
        `, [r.commune_id, r.departement_id, r.region_id, loc.id]);
        assigned++;
      }
    }

    console.log(`  Assignées à commune proche : ${assigned}`);

    // 2. Stats finales
    const stats = await client.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(commune_id) AS with_commune,
        COUNT(latitude) AS with_coords,
        COUNT(*) FILTER (WHERE commune_id IS NULL) AS no_commune,
        COUNT(*) FILTER (WHERE latitude IS NULL) AS no_coords
      FROM localites_geo
    `);
    const s = stats.rows[0];
    console.log(`\n✓ Résultat final :`);
    console.log(`  Total         : ${s.total}`);
    console.log(`  Avec commune  : ${s.with_commune}`);
    console.log(`  Avec coords   : ${s.with_coords}`);
    console.log(`  Sans commune  : ${s.no_commune}`);
    console.log(`  Sans coords   : ${s.no_coords}`);

  } catch (err) {
    console.error('Erreur fallback :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
