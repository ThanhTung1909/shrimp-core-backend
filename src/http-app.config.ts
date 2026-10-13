import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import helmet from 'helmet';

import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';

/**
 * Configures the HTTP application before routes are registered. This is kept
 * separate from bootstrap so the production HTTP security configuration can be
 * exercised without starting the MQTT client or listening on a TCP port.
 */
export function configureHttpApp(app: INestApplication): void {
  const reflector = app.get(Reflector);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          fontSrc: ["'self'", 'https:', 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        },
      },
    }),
  );

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
}
