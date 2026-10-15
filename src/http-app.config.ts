import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { createSwaggerRateLimitMiddleware } from './common/middleware/swagger-rate-limit.middleware.js';
import { RateLimitService } from './common/redis/rate-limit.service.js';

/**
 * Applies HTTP middleware before Nest starts listening for requests.
 *
 * The upstream proxy must be the only network path to this application. With
 * `trust proxy` set to 1, Express trusts exactly one proxy hop and derives
 * `req.ip` from the forwarded client address used by ThrottlerGuard.
 */
export function configureHttpApp(app: INestApplication): void {
  const expressApp = app as NestExpressApplication;
  const trustedProxyCidrs = (process.env.TRUSTED_PROXY_CIDRS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  expressApp.set(
    'trust proxy',
    trustedProxyCidrs.length > 0 ? trustedProxyCidrs : false,
  );

  const reflector = app.get(Reflector);
  const rateLimitService = app.get(RateLimitService);

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
          // Required by the bundled Swagger UI. Prefer nonces/hashes if a
          // browser-facing UI is added under this same origin.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        },
      },
    }),
  );

  const swaggerRateLimitMiddleware = createSwaggerRateLimitMiddleware(
    rateLimitService,
  );
  app.use('/api/docs', swaggerRateLimitMiddleware);
  app.use('/api/docs-json', swaggerRateLimitMiddleware);

  app.enableCors();
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector),
    new TransformInterceptor(reflector),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
