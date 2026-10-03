import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as mqtt from 'mqtt';

import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const reflector = app.get(Reflector);

  // Kích hoạt CORS cho các client khác gọi API
  app.enableCors();

  // Kích hoạt Global Exception Filter để chuẩn hóa toàn bộ lỗi (HTTP, TypeORM, Runtime)
  app.useGlobalFilters(new AllExceptionsFilter());

  // Kích hoạt Global Interceptors: ClassSerializerInterceptor và TransformInterceptor
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector),
    new TransformInterceptor(reflector),
  );

  // Kích hoạt ValidationPipe toàn cục
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(
    `🚀 [NestJS] Core Backend đang chạy tại: http://0.0.0.0:${port}`,
  );

  // Test kết nối MQTT Broker nội bộ
  const mqttUrl =
    configService.get<string>('MQTT_BROKER_URL') || 'mqtt://localhost:1883';
  const mqttClient = mqtt.connect(mqttUrl);

  mqttClient.on('connect', () => {
    console.log(`[MQTT] Kết nối thành công tới Broker: ${mqttUrl}`);
  });

  mqttClient.on('error', (err) => {
    console.error(`[MQTT] Kết nối thất bại:`, err.message);
  });
}
bootstrap();
