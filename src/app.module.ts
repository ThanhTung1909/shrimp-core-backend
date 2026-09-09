import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryModule } from './modules/telemetry/telemetry.module.js';

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

    // Module quản lý dữ liệu cảm biến chuỗi thời gian
    TelemetryModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
