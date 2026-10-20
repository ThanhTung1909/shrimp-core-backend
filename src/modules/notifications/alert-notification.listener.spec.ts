import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertNotificationListener } from './alert-notification.listener.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';

describe('AlertNotificationListener', () => {
  let listener: AlertNotificationListener;
  let mockRedisService: any;
  let mockDispatcher: any;
  let mockSubscriber: any;

  beforeEach(() => {
    mockSubscriber = {
      subscribe: vi.fn((channel, callback) => callback?.(null, 1)),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
    };
    mockRedisService = {
      getClient: vi.fn(() => ({ duplicate: vi.fn(() => mockSubscriber) })),
    };
    mockDispatcher = { dispatchAlert: vi.fn().mockResolvedValue(undefined) };
    listener = new AlertNotificationListener(mockRedisService, mockDispatcher);
  });

  it('subscribes to alert:triggered channel on init', () => {
    listener.onModuleInit();
    expect(mockSubscriber.subscribe).toHaveBeenCalledWith('alert:triggered', expect.any(Function));
  });

  it('rejects incomplete events before dispatching', async () => {
    await listener.handleAlertMessage(
      JSON.stringify({ pondId: 'pond-1', alert: { message: 'test' } }),
    );
    expect(mockDispatcher.dispatchAlert).not.toHaveBeenCalled();
  });

  it('routes a CRITICAL event through the canonical dispatcher', async () => {
    const alert = {
      alertId: 'alert-1',
      pondId: 'pond-1',
      metricName: 'dissolvedOxygen',
      triggeredValue: 2.1,
      alertLevel: AlertLevel.CRITICAL,
      message: 'Oxy hòa tan xuống mức báo động',
    };

    await listener.handleAlertMessage(
      JSON.stringify({ pondId: 'pond-1', userId: 'ignored', alert }),
    );

    expect(mockDispatcher.dispatchAlert).toHaveBeenCalledWith(alert);
  });

  it('preserves WARNING severity for preference evaluation in the dispatcher', async () => {
    await listener.handleAlertMessage(
      JSON.stringify({
        pondId: 'pond-1',
        alert: {
          alertId: 'alert-2',
          metricName: 'temperature',
          triggeredValue: 33,
          alertLevel: AlertLevel.WARNING,
        },
      }),
    );

    expect(mockDispatcher.dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({ alertLevel: AlertLevel.WARNING, pondId: 'pond-1' }),
    );
  });
});
