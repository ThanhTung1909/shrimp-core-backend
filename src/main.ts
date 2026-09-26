import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as mqtt from 'mqtt';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Kích hoạt CORS cho các client khác gọi API
  app.enableCors();

  // Kích hoạt ClassSerializerInterceptor toàn cục (để @Exclude() tự động hoạt động)
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

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
