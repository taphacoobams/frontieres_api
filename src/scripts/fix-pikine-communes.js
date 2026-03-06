/**
 * Étape 2 : Correction des communes Pikine ↔ Keur Massar
 *
 * Décret n°2021-876 du 30 juin 2021 :
 *
 * Keur Massar (6 communes) :
 *   Jaxaay-Parcelles-Niakoulrap, Keur Massar Nord, Keur Massar Sud,
 *   Malika, Yeumbeul Nord, Yeumbeul Sud
 *
 * Pikine (10 communes) :
 *   Djidah Thiaroye Kao, Pikine Nord, Pikine Ouest, Pikine Sud,
 *   Pikine Est, Thiaroye Gare, Thiaroye Sur Mer, Tivaouane Diacksao,
 *   Diamaguène Sicap Mbao, Mbao
 */

const pool = require('../database/connection');

// Communes officielles de Keur Massar (décret 2021-876)
const KEUR_MASSAR_COMMUNES = [
  'jaxaay parcelles niakoulrap',
  'jaxaay parcelles',
  'keur massar nord',
  'keur massar sud',
  'malika',
  'yeumbeul nord',
  'yeumbeul sud',
];

// Communes officielles de Pikine
const PIKINE_COMMUNES = [
  'djidah thiaroye kao',
  'pikine nord',
  'pikine ouest',
  'pikine sud',
  'pikine est',
  'thiaroye gare',
  'thiaroye sur mer',
  'tivaouane diacksao',
  'diamaguene sicap mbao',
  'diamaguène sicap mbao',
  'mbao',
  'dalifort',
  'guinaw rail nord',
  'guinaw rail sud',
];

function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function main() {
  const client = await pool.connect();

  try {
    // Récupérer IDs de Pikine et Keur Massar
    const { rows: depts } = await client.query(`
      SELECT id, name FROM departements_boundaries
      WHERE name ILIKE '%pikine%' OR name ILIKE '%keur massar%'
      ORDER BY name
    `);

    console.log('Départements trouvés :');
    depts.forEach(d => console.log(`  id=${d.id} name="${d.name}"`));

    const pikineDept = depts.find(d => normalizeName(d.name) === 'pikine');
    const keurMassarDept = depts.find(d => normalizeName(d.name).includes('keur massar'));

    if (!pikineDept) throw new Error('Département Pikine non trouvé en base');
    if (!keurMassarDept) throw new Error('Département Keur Massar non trouvé en base');

    console.log(`\n→ Pikine id=${pikineDept.id}, Keur Massar id=${keurMassarDept.id}`);

    // Charger toutes les communes des deux départements
    const { rows: communes } = await client.query(`
      SELECT id, name, departement_id FROM communes_boundaries
      WHERE departement_id IN ($1, $2)
      ORDER BY departement_id, name
    `, [pikineDept.id, keurMassarDept.id]);

    console.log(`\nCommunes actuelles des deux départements : ${communes.length}`);
    communes.forEach(c => {
      const dept = c.departement_id === pikineDept.id ? 'Pikine' : 'Keur Massar';
      console.log(`  [${dept}] id=${c.id} "${c.name}"`);
    });

    await client.query('BEGIN');

    let movedToKeurMassar = [];
    let movedToPikine = [];

    for (const commune of communes) {
      const normName = normalizeName(commune.name);
      const isKeurMassar = KEUR_MASSAR_COMMUNES.some(km => normName.includes(km) || km.includes(normName));
      const isPikine = PIKINE_COMMUNES.some(p => normName.includes(p) || p.includes(normName));

      if (isKeurMassar && commune.departement_id !== keurMassarDept.id) {
        // Déplacer vers Keur Massar
        await client.query(`
          UPDATE communes_boundaries SET departement_id = $1 WHERE id = $2
        `, [keurMassarDept.id, commune.id]);

        await client.query(`
          UPDATE localites SET departement_id = $1 WHERE commune_id = $2
        `, [keurMassarDept.id, commune.id]);

        movedToKeurMassar.push(commune.name);
      } else if (isPikine && commune.departement_id !== pikineDept.id) {
        // Déplacer vers Pikine
        await client.query(`
          UPDATE communes_boundaries SET departement_id = $1 WHERE id = $2
        `, [pikineDept.id, commune.id]);

        await client.query(`
          UPDATE localites SET departement_id = $1 WHERE commune_id = $2
        `, [pikineDept.id, commune.id]);

        movedToPikine.push(commune.name);
      }
    }

    await client.query('COMMIT');

    // Rapport
    console.log('\n=== CORRECTIONS APPLIQUÉES ===');
    if (movedToKeurMassar.length > 0) {
      console.log(`\n→ Déplacées vers Keur Massar (${movedToKeurMassar.length}) :`);
      movedToKeurMassar.forEach(n => console.log('  +', n));
    }
    if (movedToPikine.length > 0) {
      console.log(`\n→ Déplacées vers Pikine (${movedToPikine.length}) :`);
      movedToPikine.forEach(n => console.log('  +', n));
    }
    if (movedToKeurMassar.length === 0 && movedToPikine.length === 0) {
      console.log('  Aucun déplacement nécessaire — données déjà correctes.');
    }

    // Vérification finale
    const { rows: finalCommunes } = await client.query(`
      SELECT id, name, departement_id FROM communes_boundaries
      WHERE departement_id IN ($1, $2)
      ORDER BY departement_id, name
    `, [pikineDept.id, keurMassarDept.id]);

    console.log('\n=== ÉTAT FINAL ===');
    const pikineFinal = finalCommunes.filter(c => c.departement_id === pikineDept.id);
    const keurMassarFinal = finalCommunes.filter(c => c.departement_id === keurMassarDept.id);
    console.log(`\nPikine (${pikineFinal.length} communes) :`);
    pikineFinal.forEach(c => console.log(`  - ${c.name}`));
    console.log(`\nKeur Massar (${keurMassarFinal.length} communes) :`);
    keurMassarFinal.forEach(c => console.log(`  - ${c.name}`));

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
