import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Resolve repo-root `.env` (backend/src|dist → ../..). */
function rootEnvPath(): string {
  const candidates = [
    join(__dirname, '..', '..', '.env'),
    join(process.cwd(), '.env'),
    join(process.cwd(), '..', '.env'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

/** Load root `.env` before any module reads process.env. */
config({ path: rootEnvPath() });
