import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { parseTileInt, TILE_CACHE_MAX_AGE_SEC } from './tile-config';
import { TilesService } from './tiles.service';

function parseCoords(zRaw: string, xRaw: string, yRaw: string) {
  try {
    const z = parseTileInt(zRaw, 'z');
    const x = parseTileInt(xRaw, 'x');
    const y = parseTileInt(yRaw.replace(/\.mvt$/i, ''), 'y');
    return { z, x, y };
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : 'Tile không hợp lệ');
  }
}

function sendMvt(res: Response, tile: Buffer) {
  if (!tile.length) {
    res.set('Cache-Control', 'no-store');
    res.status(204).send();
    return;
  }
  res.set({
    'Content-Type': 'application/vnd.mapbox-vector-tile',
    'Cache-Control': `public, max-age=${TILE_CACHE_MAX_AGE_SEC}`,
  });
  res.status(200).send(tile);
}

@Controller('tiles')
export class TilesController {
  constructor(private readonly tilesService: TilesService) {}

  @Public()
  @Get('land-parcels/:z/:x/:y')
  async landParcelsTile(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Res() res: Response,
  ) {
    const coords = parseCoords(z, x, y);
    const tile = await this.tilesService.getMvtTile('land-parcels', coords.z, coords.x, coords.y);
    sendMvt(res, tile);
  }

  @Public()
  @Get('qhsdd/:z/:x/:y')
  async qhsddTile(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Res() res: Response,
  ) {
    const coords = parseCoords(z, x, y);
    const tile = await this.tilesService.getMvtTile('qhsdd', coords.z, coords.x, coords.y);
    sendMvt(res, tile);
  }
}
