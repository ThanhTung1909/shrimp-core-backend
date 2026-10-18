import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';

import { configureHttpApp } from './http-app.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  configureHttpApp(app);

  // Cấu hình Swagger OpenAPI Documentation tại route /api/docs
  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Shrimp Core Backend API')
    .setDescription(
      'Tài liệu API tương tác cho Hệ thống Quản lý Trang trại Nuôi tôm IoT & Cảnh báo thời gian thực',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Nhập JWT Access Token (VD: Bearer eyJhbGci...)',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, documentFactory);

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(
    `🚀 [NestJS] Core Backend đang chạy tại: http://0.0.0.0:${port}`,
  );
  console.log(
    `📚 [Swagger UI] Tài liệu API tương tác tại: http://0.0.0.0:${port}/api/docs`,
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
