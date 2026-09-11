import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from './entities/device.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Device])],
  exports: [TypeOrmModule],
})
export class DevicesModule {}
