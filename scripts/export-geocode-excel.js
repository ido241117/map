const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.join(__dirname, '..', 'data', 'excel');
const TEMP_CSV = path.join(__dirname, '.geocode-export.tmp.csv');
const ROWS_PER_FILE = 10_000;
const MAX_FILES = 48;
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

function runPsqlCopy() {
  const csvPath = TEMP_CSV.replace(/\\/g, '/');
  const sql = `
\\copy (
  SELECT
    shape_file_id,
    property_code,
    address,
    district,
    ward,
    latitude,
    longitude
  FROM land_parcels
  WHERE address IS NOT NULL AND BTRIM(address) <> ''
  ORDER BY shape_file_id
) TO '${csvPath}' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
`.trim();

  const result = spawnSync(
    'psql',
    ['-U', PGUSER, '-h', PGHOST, '-p', String(PGPORT), '-d', DB_NAME, '-c', sql],
    { env: { ...process.env, PGPASSWORD }, stdio: 'inherit' },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function splitToExcel() {
  const pythonScript = `
import math
import pandas as pd
from pathlib import Path

csv_path = r'''${TEMP_CSV.replace(/\\/g, '\\\\')}'''
out_dir = Path(r'''${OUT_DIR.replace(/\\/g, '\\\\')}''')
rows_per_file = ${ROWS_PER_FILE}
max_files = ${MAX_FILES}

out_dir.mkdir(parents=True, exist_ok=True)

total = sum(1 for _ in open(csv_path, encoding='utf-8')) - 1
file_count = min(max_files, math.ceil(total / rows_per_file))
print(f'Total {total:,} rows -> {file_count} Excel files (max {rows_per_file:,} rows each)')

for i, chunk in enumerate(pd.read_csv(csv_path, chunksize=rows_per_file)):
    if i >= max_files:
        break
    chunk['google_lat_lng'] = ''
    out_path = out_dir / f'{i + 1:02d}.xlsx'
    chunk.to_excel(out_path, index=False, engine='openpyxl')
    print(f'  {out_path.name}: {len(chunk):,} rows')

print(f'Done: {out_dir}')
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
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Export CSV từ land_parcels...');
  runPsqlCopy();

  console.log('Chia thành file Excel...');
  splitToExcel();

  fs.rmSync(TEMP_CSV, { force: true });
}

main();
