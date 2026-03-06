const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '../../sen_admin_boundaries.geojson');

// admin2 : tous les départements avec leur pcode
const admin2 = JSON.parse(fs.readFileSync(path.join(base, 'sen_admin2.geojson'), 'utf8'));
console.log('=== sen_admin2.geojson : ' + admin2.features.length + ' départements ===');
admin2.features.forEach(f => {
  const p = f.properties;
  console.log(`  pcode=${p.adm2_pcode} name="${p.adm2_name}" region="${p.adm1_name}" center=${p.center_lat},${p.center_lon} area=${p.area_sqkm}`);
});

// admin3 : arrondissements avec leur rattachement
const admin3 = JSON.parse(fs.readFileSync(path.join(base, 'sen_admin3.geojson'), 'utf8'));
console.log('\n=== sen_admin3.geojson : ' + admin3.features.length + ' arrondissements ===');
admin3.features.forEach(f => {
  const p = f.properties;
  console.log(`  pcode=${p.adm3_pcode} name="${p.adm3_name}" dept="${p.adm2_name}" region="${p.adm1_name}" center=${p.center_lat},${p.center_lon} area=${p.area_sqkm}`);
});

// admin1 : régions
const admin1 = JSON.parse(fs.readFileSync(path.join(base, 'sen_admin1.geojson'), 'utf8'));
console.log('\n=== sen_admin1.geojson : ' + admin1.features.length + ' régions ===');
admin1.features.forEach(f => {
  const p = f.properties;
  console.log(`  pcode=${p.adm1_pcode} name="${p.adm1_name}" center=${p.center_lat},${p.center_lon} area=${p.area_sqkm}`);
});
