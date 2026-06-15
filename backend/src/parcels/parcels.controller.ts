import { Controller, Get, Param, Query } from '@nestjs/common';
import { ParcelsService } from './parcels.service';

@Controller()
export class ParcelsController {
  constructor(private readonly parcelsService: ParcelsService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('parcels')
  listParcels(
    @Query('q') q?: string,
    @Query('district') district?: string,
    @Query('ward') ward?: string,
    @Query('landType') landType?: string,
    @Query('minArea') minArea?: string,
    @Query('maxArea') maxArea?: string,
    @Query('minLat') minLat?: string,
    @Query('maxLat') maxLat?: string,
    @Query('minLng') minLng?: string,
    @Query('maxLng') maxLng?: string,
    @Query('includeGeometry') includeGeometry?: string,
    @Query('limit') limit?: string,
  ) {
    return this.parcelsService.list({
      q,
      district,
      ward,
      landType,
      minArea: minArea ? Number(minArea) : undefined,
      maxArea: maxArea ? Number(maxArea) : undefined,
      minLat: minLat ? Number(minLat) : undefined,
      maxLat: maxLat ? Number(maxLat) : undefined,
      minLng: minLng ? Number(minLng) : undefined,
      maxLng: maxLng ? Number(maxLng) : undefined,
      includeGeometry: includeGeometry === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('parcels/:id')
  getParcel(@Param('id') id: string) {
    return this.parcelsService.getById(Number(id));
  }

  @Get('stats')
  stats() {
    return this.parcelsService.stats();
  }
}
