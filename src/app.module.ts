import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryModule } from './modules/telemetry/telemetry.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PondsModule } from './modules/ponds/ponds.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { AlertsModule } from './modules/alerts/alerts.module.js';
import { PredictionsModule } from './modules/predictions/predictions.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { RedisService } from './common/redis/redis.service.js';
import { RedisThrottlerStorage } from './common/redis/redis-throttler.storage.js';
import { QueueModule } from './common/queues/queue.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { FarmsModule } from './modules/farms/farms.module.js';
import { CropsModule } from './modules/crops/crops.module.js';

import { ScheduleModule } from '@nestjs/schedule';
import { EsmsModule } from './common/esms/esms.module.js';
import { HttpThrottlerGuard } from './common/guards/http-throttler.guard.js';
import {
  createDatabaseStartupOptions,
  isHttpOnlyMode,
} from './common/runtime/http-only-mode.js';

const httpOnlyMode = isHttpOnlyMode();

@Module({
  imports: [
    // Load biến môi trường toàn cục
    ConfigModule.forRoot({ isGlobal: true }),
    ...(!httpOnlyMode ? [ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redisService: RedisService) => ({
        throttlers: [
          {
            ttl: 60_000,
            limit: 60,
          },
        ],
        storage: new RedisThrottlerStorage(redisService),
      }),
    })] : []),
    ...(!httpOnlyMode ? [ScheduleModule.forRoot()] : []),

    // Kết nối CSDL TimescaleDB
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createDatabaseStartupOptions(config, httpOnlyMode),
    }),

    // Module xác thực và phân quyền
    AuthModule,

    // Module lưu trữ dữ liệu in-memory Redis (Global)
    RedisModule,

    // Module Message Queue BullMQ (Redis Streams)
    ...(!httpOnlyMode ? [QueueModule] : []),
    // Module SMS (Global)
    EsmsModule,

    // Module Thông báo nền (Email, SMS, FCM)
    NotificationsModule,

    // Các modules thực thể cốt lõi
    UsersModule,
    FarmsModule,
    PondsModule,
    CropsModule,
    DevicesModule,
    AlertsModule,
    PredictionsModule,

    // Module quản lý dữ liệu cảm biến chuỗi thời gian
    TelemetryModule,
  ],
  controllers: [],
  providers: !httpOnlyMode
    ? [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }]
    : [],
})
export class AppModule { }
