import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { TileKind } from './tile-config';
import { tileCacheRoot } from './tile-config';

function tilePath(kind: TileKind, z: number, x: number, y: number): string {
  return path.join(tileCacheRoot(), kind, String(z), String(x), `${y}.mvt`);
}

export async function readCachedTile(
  kind: TileKind,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const filePath = tilePath(kind, z, x, y);
  if (!existsSync(filePath)) {
    return null;
  }
  return readFile(filePath);
}

export async function writeCachedTile(
  kind: TileKind,
  z: number,
  x: number,
  y: number,
  data: Buffer,
): Promise<void> {
  if (!data.length) {
    return;
  }
  const filePath = tilePath(kind, z, x, y);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}

export function tileCacheEnabled(): boolean {
  return Boolean(process.env.TILE_CACHE_DIR?.trim() || process.env.TILE_CACHE_ENABLED === '1');
}
