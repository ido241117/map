import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../shared/database.service';
import { buildMvtQuery, type AdminTileFilter } from './mvt-builder';
import {
  assertTileCoords,
  minZoomFor,
  simplifyToleranceDeg,
  type TileKind,
} from './tile-config';
import { readCachedTile, tileCacheEnabled, writeCachedTile } from './tile-cache';

@Injectable()
export class TilesService {
  constructor(private readonly db: DatabaseService) {}

  async getMvtTile(
    kind: TileKind,
    z: number,
    x: number,
    y: number,
    admin?: AdminTileFilter,
  ): Promise<Buffer> {
    assertTileCoords(z, x, y);

    if (z < minZoomFor(kind)) {
      return Buffer.alloc(0);
    }

    const tolerance = simplifyToleranceDeg(z, kind);
    if (tolerance === null) {
      return Buffer.alloc(0);
    }

    const hasAdminFilter = Boolean(admin?.district?.trim() || admin?.ward?.trim());
    if (tileCacheEnabled() && !hasAdminFilter) {
      const cached = await readCachedTile(kind, z, x, y);
      if (cached) {
        return cached;
      }
    }

    const { sql, params } = buildMvtQuery(kind, z, x, y, tolerance, admin);
    const { rows } = await this.db.query<{ tile: Buffer | null }>(sql, params);
    const tile = rows[0]?.tile;
    if (!tile || tile.length === 0) {
      return Buffer.alloc(0);
    }

    if (tileCacheEnabled() && !hasAdminFilter) {
      await writeCachedTile(kind, z, x, y, tile);
    }

    return tile;
  }
}
