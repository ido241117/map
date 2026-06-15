import { Module } from '@nestjs/common';
import { ParcelsController } from './parcels/parcels.controller';
import { ParcelsService } from './parcels/parcels.service';
import { DatabaseService } from './shared/database.service';

@Module({
  controllers: [ParcelsController],
  providers: [DatabaseService, ParcelsService],
})
export class AppModule {}
