const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SQL_PATH = path.join(__dirname, 'import-property-buys.sql');
const XLSX_PATH = path.join(__dirname, '..', 'New Microsoft Excel Worksheet.xlsx');
const CSV_PATH = path.join(__dirname, '.property-buys.tmp.csv');
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

function runPsql(database, sqlFile) {
  return spawnSync(
    'psql',
    ['-U', PGUSER, '-h', PGHOST, '-p', String(PGPORT), '-d', database, '-f', sqlFile],
    {
      env: { ...process.env, PGPASSWORD },
      stdio: 'inherit',
    },
  );
}

function convertExcelToCsv() {
  const pythonScript = `
import pandas as pd

df = pd.read_excel(r'''${XLSX_PATH.replace(/\\/g, '\\\\')}''')
df = df.rename(columns={'round': 'street', 'id': 'record_id'})
df.to_csv(r'''${CSV_PATH.replace(/\\/g, '\\\\')}''', index=False, encoding='utf-8')
print(f'Converted {len(df)} rows to CSV')
`;

  const result = spawnSync('python', ['-c', pythonScript], {
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`Không tìm thấy file Excel: ${XLSX_PATH}`);
    process.exit(1);
  }

  console.log(`Đọc Excel: ${XLSX_PATH}`);
  convertExcelToCsv();

  const tempSqlPath = path.join(__dirname, '.import-property-buys.tmp.sql');
  const sql = fs.readFileSync(SQL_PATH, 'utf8').replace(
    '__CSV_PATH__',
    CSV_PATH.replace(/\\/g, '/'),
  );
  fs.writeFileSync(tempSqlPath, sql);

  console.log('Import vào PostgreSQL...');
  const result = runPsql(DB_NAME, tempSqlPath);

  fs.rmSync(tempSqlPath, { force: true });
  fs.rmSync(CSV_PATH, { force: true });

  process.exit(result.status ?? 1);
}

main();
