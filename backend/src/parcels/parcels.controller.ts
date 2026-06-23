import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ParcelsService } from './parcels.service';
import { QhsddService } from './qhsdd.service';

@Controller()
export class ParcelsController {
  constructor(
    private readonly parcelsService: ParcelsService,
    private readonly qhsddService: QhsddService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('parcels')
  listParcels(
    @Query('source') source?: string,
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
    @Query('zoom') zoom?: string,
    @Query('limit') limit?: string,
  ) {
    return this.parcelsService.list({
      source,
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
      includeGeometry: includeGeometry === 'true' ? true : includeGeometry === 'false' ? false : undefined,
      zoom: zoom ? Number(zoom) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('parcels/address-suggest')
  suggestAddress(
    @Query('source') source?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('district') district?: string,
    @Query('ward') ward?: string,
  ) {
    return this.parcelsService.suggestAddress(
      source,
      q || '',
      limit ? Number(limit) : undefined,
      district,
      ward,
    );
  }

  @Get('parcels/admin-bounds')
  adminBounds(
    @Query('district') district?: string,
    @Query('ward') ward?: string,
  ) {
    return this.parcelsService.adminBounds(district, ward);
  }

  @Get('parcels/:id')
  getParcel(@Param('id') id: string, @Query('source') source?: string) {
    return this.parcelsService.getById(Number(id), source);
  }

  @Get('stats')
  stats(@Query('source') source?: string) {
    return this.parcelsService.stats(source);
  }

  @Get('qhsdd/zones')
  listQhsddZones(
    @Query('minLat') minLat?: string,
    @Query('maxLat') maxLat?: string,
    @Query('minLng') minLng?: string,
    @Query('maxLng') maxLng?: string,
    @Query('landType') landType?: string,
    @Query('zoom') zoom?: string,
    @Query('limit') limit?: string,
  ) {
    return this.qhsddService.listInViewport({
      minLat: minLat ? Number(minLat) : undefined,
      maxLat: maxLat ? Number(maxLat) : undefined,
      minLng: minLng ? Number(minLng) : undefined,
      maxLng: maxLng ? Number(maxLng) : undefined,
      landType,
      zoom: zoom ? Number(zoom) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('qhsdd/stats')
  qhsddStats() {
    return this.qhsddService.stats();
  }
}
