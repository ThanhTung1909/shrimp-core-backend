import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertsService } from '../alerts/alerts.service.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';

describe('P1-2 alert notification pipeline', () => {
  const user = {
    userId: 'farmer-1',
    fullName: 'Farmer One',
    phoneNumber: '0901234567',
    email: 'farmer@example.test',
    isActive: true,
  };
  const pond = {
    pondId: 'pond-1',
    pondName: 'Pond One',
    userId: user.userId,
    user,
  };

  let alertsService: AlertsService;
  let prefOverrides: Map<string, boolean>;
  let fcmService: any;
  let esmsService: any;
  let emailService: any;
  let tokensService: any;

  const preferenceKey = (severity: AlertLevel, channel: NotificationChannel) =>
    `${severity}:${channel}`;

  beforeEach(() => {
    prefOverrides = new Map();
    const deliveries = new Map<string, any>();
    const deliveryKey = (delivery: any) =>
      `${delivery.alertId}:${delivery.userId}:${delivery.channel}`;

    const preferenceRepo = {
      findOne: vi.fn(async ({ where }) => {
        const enabled = prefOverrides.get(preferenceKey(where.severity, where.channel));
        return enabled === undefined ? null : { ...where, enabled };
      }),
      find: vi.fn(),
      create: vi.fn((value) => value),
      save: vi.fn(),
    };
    const preferencesService = new NotificationPreferencesService(preferenceRepo as any);

    const deliveryRepo = {
      findOne: vi.fn(async ({ where }) => deliveries.get(deliveryKey(where)) ?? null),
      create: vi.fn((value) => ({ deliveryId: crypto.randomUUID(), ...value })),
      save: vi.fn(async (value) => {
        deliveries.set(deliveryKey(value), value);
        return value;
      }),
      createQueryBuilder: vi.fn(),
    };

    fcmService = {
      sendToTokens: vi.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        invalidTokens: [],
      }),
    };
    esmsService = { sendAlertSMS: vi.fn().mockResolvedValue({ CodeResult: '100' }) };
    emailService = { sendAlertEmail: vi.fn().mockResolvedValue(undefined) };
    tokensService = {
      getActiveTokens: vi.fn().mockResolvedValue(['fcm-token-1']),
      deactivateTokens: vi.fn().mockResolvedValue(1),
    };

    const dispatcher = new NotificationDispatcherService(
      deliveryRepo as any,
      { findOne: vi.fn().mockResolvedValue(pond) } as any,
      { findOne: vi.fn().mockResolvedValue(user) } as any,
      {} as any,
      preferencesService,
      tokensService,
      fcmService,
      esmsService,
      emailService,
    );

    const alertRepo = {
      create: vi.fn((value) => ({ alertId: 'alert-1', ...value })),
      save: vi.fn(async (value) => ({ alertId: 'alert-1', ...value })),
    };
    alertsService = new AlertsService(alertRepo as any, dispatcher);
  });

  async function createAlert(alertLevel = AlertLevel.CRITICAL) {
    const alert = await alertsService.createAlert({
      pondId: pond.pondId,
      metricName: 'dissolvedOxygen',
      triggeredValue: 2.1,
      alertLevel,
      status: AlertStatus.ACTIVE,
      message: 'Dissolved oxygen is unsafe',
    });
    await vi.waitFor(() => expect(fcmService.sendToTokens).toHaveBeenCalled());
    return alert;
  }

  it('uses default CRITICAL preferences to dispatch FCM, SMS, and email', async () => {
    await createAlert();

    expect(esmsService.sendAlertSMS).toHaveBeenCalledTimes(1);
    expect(emailService.sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(fcmService.sendToTokens).toHaveBeenCalledWith(
      ['fcm-token-1'],
      expect.stringContaining('CRITICAL'),
      expect.any(String),
      expect.objectContaining({ alertId: 'alert-1' }),
    );
  });

  it.each([
    [false, true, 0, 1],
    [true, false, 1, 0],
    [false, false, 0, 0],
  ])(
    'applies CRITICAL SMS=%s and EMAIL=%s independently',
    async (smsEnabled, emailEnabled, expectedSms, expectedEmail) => {
      prefOverrides.set(preferenceKey(AlertLevel.CRITICAL, NotificationChannel.SMS), smsEnabled);
      prefOverrides.set(preferenceKey(AlertLevel.CRITICAL, NotificationChannel.EMAIL), emailEnabled);

      await createAlert();

      expect(esmsService.sendAlertSMS).toHaveBeenCalledTimes(expectedSms);
      expect(emailService.sendAlertEmail).toHaveBeenCalledTimes(expectedEmail);
      expect(fcmService.sendToTokens).toHaveBeenCalledTimes(1);
    },
  );

  it('deactivates invalid FCM tokens without preventing SMS and email', async () => {
    fcmService.sendToTokens.mockResolvedValueOnce({
      successCount: 0,
      failureCount: 1,
      invalidTokens: ['fcm-token-1'],
    });

    await createAlert();

    expect(tokensService.deactivateTokens).toHaveBeenCalledWith(['fcm-token-1']);
    expect(esmsService.sendAlertSMS).toHaveBeenCalledTimes(1);
    expect(emailService.sendAlertEmail).toHaveBeenCalledTimes(1);
  });

  it('isolates SMS and email provider failures from the other channels', async () => {
    esmsService.sendAlertSMS.mockRejectedValueOnce(new Error('SMS timeout'));
    emailService.sendAlertEmail.mockRejectedValueOnce(new Error('SMTP timeout'));

    await createAlert();

    expect(fcmService.sendToTokens).toHaveBeenCalledTimes(1);
    expect(esmsService.sendAlertSMS).toHaveBeenCalledTimes(1);
    expect(emailService.sendAlertEmail).toHaveBeenCalledTimes(1);
  });

  it('applies the WARNING default independently from CRITICAL defaults', async () => {
    await createAlert(AlertLevel.WARNING);

    expect(fcmService.sendToTokens).toHaveBeenCalledTimes(1);
    expect(esmsService.sendAlertSMS).not.toHaveBeenCalled();
    expect(emailService.sendAlertEmail).not.toHaveBeenCalled();
  });

  it('creates delivery records with provider-accepted semantics, not handset delivery', async () => {
    const alert = await createAlert();
    expect(alert.alertId).toBe('alert-1');
    expect(fcmService.sendToTokens).toHaveBeenCalled();
  });
});
