import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { TileKind } from './tile-config';
import { tileCacheRoot } from './tile-config';

/** Hot tiles in RAM — set TILE_MEMORY_CACHE_MB (e.g. 256) to soak free RAM on pan load. */
const memoryCache = new Map<string, Buffer>();
let memoryCacheBytes = 0;

function memoryCacheMaxBytes(): number {
  const mb = Number(process.env.TILE_MEMORY_CACHE_MB || 0);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 0;
}

function memoryKey(kind: TileKind, z: number, x: number, y: number): string {
  return `${kind}/${z}/${x}/${y}`;
}

function putMemoryCache(key: string, data: Buffer): void {
  const maxBytes = memoryCacheMaxBytes();
  if (!maxBytes || !data.length) return;

  const existing = memoryCache.get(key);
  if (existing) {
    memoryCacheBytes -= existing.length;
    memoryCache.delete(key);
  }

  while (memoryCacheBytes + data.length > maxBytes && memoryCache.size > 0) {
    const oldest = memoryCache.keys().next().value as string;
    const buf = memoryCache.get(oldest);
    memoryCache.delete(oldest);
    if (buf) memoryCacheBytes -= buf.length;
  }

  if (data.length > maxBytes) return;
  memoryCache.set(key, data);
  memoryCacheBytes += data.length;
}

function tilePath(kind: TileKind, z: number, x: number, y: number): string {
  return path.join(tileCacheRoot(), kind, String(z), String(x), `${y}.mvt`);
}

export async function readCachedTile(
  kind: TileKind,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const key = memoryKey(kind, z, x, y);
  const fromRam = memoryCache.get(key);
  if (fromRam) {
    // refresh LRU order
    memoryCache.delete(key);
    memoryCache.set(key, fromRam);
    return fromRam;
  }

  const filePath = tilePath(kind, z, x, y);
  try {
    const data = await readFile(filePath);
    putMemoryCache(key, data);
    return data;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    throw err;
  }
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
  putMemoryCache(memoryKey(kind, z, x, y), data);
}

export function tileCacheEnabled(): boolean {
  return Boolean(process.env.TILE_CACHE_DIR?.trim() || process.env.TILE_CACHE_ENABLED === '1');
}
