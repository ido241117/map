import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../shared/database.service';
import { OsmDatabaseService } from '../shared/osm-database.service';
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
  constructor(
    private readonly db: DatabaseService,
    private readonly osmDb: OsmDatabaseService,
  ) {}

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
    // Highways: no district/ward filter; always cache-friendly.
    const canCache = tileCacheEnabled() && (kind === 'highways' || !hasAdminFilter);
    if (canCache) {
      const cached = await readCachedTile(kind, z, x, y);
      if (cached) {
        return cached;
      }
    }

    const { sql, params } = buildMvtQuery(kind, z, x, y, tolerance, admin);
    let tile: Buffer | null | undefined;
    try {
      const queryDb = kind === 'highways' ? this.osmDb : this.db;
      const { rows } = await queryDb.query<{ tile: Buffer | null }>(sql, params);
      tile = rows[0]?.tile;
    } catch (error) {
      // Overlay optional — map parcels/QHSDD still work if OSM DB is down.
      if (kind === 'highways' && error instanceof ServiceUnavailableException) {
        return Buffer.alloc(0);
      }
      throw error;
    }

    if (!tile || tile.length === 0) {
      return Buffer.alloc(0);
    }

    if (canCache) {
      await writeCachedTile(kind, z, x, y, tile);
    }

    return tile;
  }
}
