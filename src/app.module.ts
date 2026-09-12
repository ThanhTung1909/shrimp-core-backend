import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryModule } from './modules/telemetry/telemetry.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PondsModule } from './modules/ponds/ponds.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { AlertsModule } from './modules/alerts/alerts.module.js';
import { PredictionsModule } from './modules/predictions/predictions.module.js';
import { AuthModule } from './modules/auth/auth.module.js';

@Module({
  imports: [
    // Load biến môi trường toàn cục
    ConfigModule.forRoot({ isGlobal: true }),

    // Kết nối CSDL TimescaleDB
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASS'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),

    //Module xác thực và phân quyền
    AuthModule,
    
    // Các modules thực thể cốt lõi
    UsersModule,
    PondsModule,
    DevicesModule,
    AlertsModule,
    PredictionsModule,

    // Module quản lý dữ liệu cảm biến chuỗi thời gian
    TelemetryModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
