import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationTokensService } from './notification-tokens.service.js';
import { NotificationsController } from './notifications.controller.js';

describe('NotificationsController authorization boundary', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('does not let a caller update another user preferences through the request body', async () => {
    const preferencesService = {
      updatePreferences: vi.fn().mockResolvedValue([]),
      getUserPreferences: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationPreferencesService, useValue: preferencesService },
        { provide: NotificationTokensService, useValue: {} },
        { provide: NotificationDispatcherService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { userId: 'user-a' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    await request(app.getHttpServer())
      .patch('/notifications/preferences')
      .send({
        userId: 'user-b',
        severity: AlertLevel.CRITICAL,
        channel: NotificationChannel.SMS,
        enabled: false,
      })
      .expect(200);

    expect(preferencesService.updatePreferences).toHaveBeenCalledWith('user-a', {
      severity: AlertLevel.CRITICAL,
      channel: NotificationChannel.SMS,
      enabled: false,
    });
  });
});
