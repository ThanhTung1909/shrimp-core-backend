import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TelemetryData } from './entities/telemetry-data.entity.js';
import { Device } from '../devices/entities/device.entity.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { TelemetryService } from './telemetry.service.js';
import { TelemetryMqttService } from './telemetry-mqtt.service.js';
import { TelemetryController } from './telemetry.controller.js';
import { DeviceHealthService } from './device-health.service.js';
import { TelemetryGateway } from './telemetry.gateway.js';
import { RedisModule } from '../../common/redis/redis.module.js';
import { PondsModule } from '../ponds/ponds.module.js';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    forwardRef(() => PondsModule),
    TypeOrmModule.forFeature([TelemetryData, Device, Alert]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: (configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m') as any,
        },
      }),
    }),
  ],
  controllers: [TelemetryController],
  providers: [
    TelemetryService,
    TelemetryMqttService,
    DeviceHealthService,
    TelemetryGateway,
  ],
  exports: [
    TelemetryService,
    TelemetryMqttService,
    TelemetryGateway,
    TypeOrmModule,
  ],
})
export class TelemetryModule {}
