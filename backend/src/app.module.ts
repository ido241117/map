import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ParcelsController } from './parcels/parcels.controller';
import { ParcelsService } from './parcels/parcels.service';
import { PropertyBuysController } from './property-buys/property-buys.controller';
import { PropertyBuysService } from './property-buys/property-buys.service';
import { ElasticService } from './search/elastic.service';
import { ParcelSearchService } from './search/parcel-search.service';
import { QhsddService } from './parcels/qhsdd.service';
import { DatabaseService } from './shared/database.service';
import { TilesController } from './tiles/tiles.controller';
import { TilesService } from './tiles/tiles.service';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'hcm-land-dev-secret-change-me',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController, ParcelsController, PropertyBuysController, TilesController],
  providers: [
    DatabaseService,
    TilesService,
    QhsddService,
    AuthService,
    ElasticService,
    ParcelSearchService,
    ParcelsService,
    PropertyBuysService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
