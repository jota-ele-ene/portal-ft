// scripts/generate-cp-city-from-paste.js
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');

const ROOT_DIR = __dirname; // ajusta si ejecutas desde otra carpeta
// El CSV debe tener columnas con nombres como "codigo_postal", "cp", "CODIGO_POSTAL", "CodigoPostal" para el código postal
// y "nombre", "NOMBRE", "municipio", "MUNICIPIO" para el nombre de la ciudad
// Puedes copiar y pegar el CSV desde Excel o Google Sheets, guardarlo como cp_ciudades.csv en data/uploads, y luego ejecutar este script para generar cp_city.json
// Ejemplo: https://github.com/inigoflores/ds-codigos-postales/blob/master/data/codigos_postales_municipios_join.csv
const INPUT_CSV = path.join(ROOT_DIR, 'data', 'uploads', 'cp_ciudades.csv');
const OUTPUT_JSON = path.join(ROOT_DIR, 'data', 'cp_city.json');

async function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true }))
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main() {
  console.log('Leyendo', INPUT_CSV);
  const rows = await readCsv(INPUT_CSV);

  // Mapa cp -> ciudad (si hay varias filas con el mismo CP, nos quedamos con la primera)
  const resultMap = new Map();

  for (const row of rows) {
    const cp =
      row.codigo_postal || row.cp || row.CODIGO_POSTAL || row.CodigoPostal;
    const nombre =
      row.nombre || row.NOMBRE || row.municipio || row.MUNICIPIO;

    if (!cp || !nombre) continue;

    if (!resultMap.has(cp)) {
      resultMap.set(cp, {
        cp: cp,
        ciudad: nombre,
        provincia: '' // lo puedes rellenar más adelante
      });
    }
  }

  const resultArray = Array.from(resultMap.values());
  console.log(`Generadas ${resultArray.length} entradas`);

  await fs.promises.mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await fs.promises.writeFile(
    OUTPUT_JSON,
    JSON.stringify(resultArray, null, 2),
    'utf-8'
  );

  console.log('cp_city.json guardado en', OUTPUT_JSON);
}

main().catch(err => {
  console.error('Error generando cp_city.json', err);
  process.exit(1);
});