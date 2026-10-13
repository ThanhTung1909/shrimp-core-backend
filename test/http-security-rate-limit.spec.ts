import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import {
  Throttle,
  ThrottlerGuard,
  ThrottlerModule,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import { configureHttpApp } from '../src/http-app.config.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { RateLimitService } from '../src/common/redis/rate-limit.service.js';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { ConfigService } from '@nestjs/config';
import { Role } from '../src/common/enums/role.enum.js';

const TEST_JWT_SECRET = 'p0-4-test-access-secret-at-least-32-characters';

@Controller('test-api')
class TestApiController {
  @Get('normal')
  normal() {
    return { ok: true };
  }
}

@Controller('auth')
@Throttle({ default: { limit: 5, ttl: 60_000 } })
class TestAuthController {
  @Get('public')
  publicEndpoint() {
    return { ok: true };
  }
}

async function createTestApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot([
        {
          ttl: 60_000,
          limit: 60,
        },
      ]),
    ],
    controllers: [TestApiController, TestAuthController],
    providers: [
      {
        provide: APP_GUARD,
        useClass: ThrottlerGuard,
      },
    ],
  }).compile();

  const app = module.createNestApplication();
  configureHttpApp(app);

  const swaggerConfig = new DocumentBuilder().setTitle('Test API').build();
  SwaggerModule.setup(
    'api/docs',
    app,
    () => SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.init();
  return app;
}

async function createAuthControllerTestApp(): Promise<{
  app: INestApplication;
  authService: { login: ReturnType<typeof vi.fn> };
  usersService: { findById: ReturnType<typeof vi.fn> };
  rateLimitService: { checkLimit: ReturnType<typeof vi.fn> };
}> {
  const authService = {
    login: vi.fn().mockResolvedValue({
      userId: 'p0-4-user',
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    }),
  };
  const user = {
    userId: 'p0-4-user',
    fullName: 'P0-4 Test User',
    phoneNumber: '0987654321',
    role: Role.FARMER,
    tokenVersion: 0,
    isActive: true,
    passwordHash: 'not-exposed',
  };
  const usersService = {
    findById: vi.fn().mockResolvedValue(user),
    sanitizeUser: vi.fn(({ passwordHash: _passwordHash, ...safeUser }) => safeUser),
  };
  const rateLimitService = {
    checkLimit: vi.fn().mockResolvedValue({
      allowed: true,
      count: 1,
      remaining: 99,
      retryAfterSeconds: 0,
    }),
  };

  const module = await Test.createTestingModule({
    imports: [
      PassportModule.register({ defaultStrategy: 'jwt' }),
      JwtModule.register({ secret: TEST_JWT_SECRET }),
      ThrottlerModule.forRoot([
        {
          ttl: 60_000,
          limit: 60,
        },
      ]),
    ],
    controllers: [AuthController],
    providers: [
      JwtStrategy,
      JwtAuthGuard,
      RolesGuard,
      {
        provide: APP_GUARD,
        useClass: ThrottlerGuard,
      },
      {
        provide: ConfigService,
        useValue: {
          get: vi.fn((key: string) =>
            key === 'JWT_ACCESS_SECRET' ? TEST_JWT_SECRET : undefined,
          ),
        },
      },
      { provide: AuthService, useValue: authService },
      { provide: UsersService, useValue: usersService },
      { provide: RateLimitService, useValue: rateLimitService },
    ],
  }).compile();

  const app = module.createNestApplication();
  configureHttpApp(app);
  await app.init();

  return { app, authService, usersService, rateLimitService };
}

describe('HTTP security headers and throttling', () => {
  it('allows 60 ordinary REST requests and rejects request 61 with HTTP 429', async () => {
    const app = await createTestApp();
    try {
      for (let index = 0; index < 60; index += 1) {
        await request(app.getHttpServer()).get('/test-api/normal').expect(200);
      }

      const res61 = await request(app.getHttpServer()).get('/test-api/normal').expect(429);
      expect(res61.body).toMatchObject({
        success: false,
        statusCode: 429,
        errorCode: 'TOO_MANY_REQUESTS',
      });
      expect(res61.body.timestamp).toBeDefined();
      expect(res61.body.path).toBe('/test-api/normal');
    } finally {
      await app.close();
    }
  }, 20_000);

  it('uses the Auth override of 5 requests per minute instead of the REST limit', async () => {
    const app = await createTestApp();
    try {
      for (let index = 0; index < 5; index += 1) {
        await request(app.getHttpServer()).get('/auth/public').expect(200);
      }

      const resAuth6 = await request(app.getHttpServer()).get('/auth/public').expect(429);
      expect(resAuth6.body).toMatchObject({
        success: false,
        statusCode: 429,
        errorCode: 'TOO_MANY_REQUESTS',
      });
      expect(resAuth6.body.path).toBe('/auth/public');
    } finally {
      await app.close();
    }
  });

  it('limits the production public POST /auth/login endpoint to five requests', async () => {
    const { app, authService, rateLimitService } = await createAuthControllerTestApp();
    try {
      for (let index = 0; index < 5; index += 1) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .set('X-Forwarded-For', `198.51.100.${index + 1}`)
          .send({ phoneNumber: '0987654321', password: 'Password123!' })
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.1')
        .send({ phoneNumber: '0987654321', password: 'Password123!' })
        .expect(429);

      expect(authService.login).toHaveBeenCalledTimes(5);
      expect(rateLimitService.checkLimit).toHaveBeenCalledTimes(10);
    } finally {
      await app.close();
    }
  });

  it('limits production JWT-protected GET /auth/me after the actual JWT guard accepts five requests', async () => {
    const { app, usersService } = await createAuthControllerTestApp();
    try {
      const jwtService = app.get(JwtService);
      const accessToken = await jwtService.signAsync({
        sub: 'p0-4-user',
        tokenVersion: 0,
        role: Role.FARMER,
        type: 'access',
      });

      for (let index = 0; index < 5; index += 1) {
        await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
      }

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(429);

      expect(usersService.findById).toHaveBeenCalledTimes(5);
    } finally {
      await app.close();
    }
  });

  it('tracks separate client IP addresses independently', async () => {
    const reflector = new Reflector();
    const guard = new ThrottlerGuard(
      [{ ttl: 60_000, limit: 1 }],
      new ThrottlerStorageService(),
      reflector,
    );
    await guard.onModuleInit();

    const handler = () => undefined;
    const controller = class TestController {};
    const response = { header: () => undefined };
    const contextFor = (ip: string) => ({
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ ip, headers: {} }),
        getResponse: () => response,
      }),
    });

    await expect(guard.canActivate(contextFor('203.0.113.10') as any)).resolves.toBe(true);
    await expect(guard.canActivate(contextFor('203.0.113.11') as any)).resolves.toBe(true);
    await expect(guard.canActivate(contextFor('203.0.113.10') as any)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('sets Helmet headers and preserves Swagger and CORS responses', async () => {
    const app = await createTestApp();
    try {
      const normalResponse = await request(app.getHttpServer())
        .get('/test-api/normal')
        .set('Origin', 'https://client.example.test')
        .expect(200);

      expect(normalResponse.headers['content-security-policy']).toContain("default-src 'self'");
      expect(normalResponse.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(normalResponse.headers['x-content-type-options']).toBe('nosniff');
      expect(normalResponse.headers['access-control-allow-origin']).toBe('*');
      expect(normalResponse.headers['referrer-policy']).toBe('no-referrer');
      expect(normalResponse.headers['cross-origin-opener-policy']).toBe('same-origin');

      // Swagger UI documentation endpoint is accessible
      await request(app.getHttpServer()).get('/api/docs').expect(200);

      // Verify Helmet headers persist on 404 error responses
      const notFoundResponse = await request(app.getHttpServer())
        .get('/non-existent-route')
        .expect(404);
      expect(notFoundResponse.headers['x-content-type-options']).toBe('nosniff');
      expect(notFoundResponse.headers['x-frame-options']).toBe('SAMEORIGIN');
    } finally {
      await app.close();
    }
  });
});
