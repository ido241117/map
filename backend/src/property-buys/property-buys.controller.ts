import { Controller, Get, Query } from '@nestjs/common';
import { PropertyBuysService } from './property-buys.service';

@Controller('property-buy-records')
export class PropertyBuysController {
  constructor(private readonly propertyBuysService: PropertyBuysService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('district') district?: string,
    @Query('ward') ward?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.propertyBuysService.list({
      q,
      district,
      ward,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('filter-options')
  filterOptions() {
    return this.propertyBuysService.filterOptions();
  }

  @Get('map-points')
  mapPoints(@Query('limit') limit?: string) {
    return this.propertyBuysService.mapPoints(limit ? Number(limit) : 100);
  }
}
