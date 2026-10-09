import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { AlertsService } from './alerts.service.js';

describe('AlertsService', () => {
  let service: AlertsService;
  let alertRepo: any;

  beforeEach(() => {
    alertRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ alertId: 'alert-1', ...data })),
    };
    service = new AlertsService(alertRepo);
  });

  it('creates an active WARNING alert for a low threshold violation', async () => {
    const result = await service.createThresholdAlert({
      pondId: 'pond-1',
      deviceId: 'device-1',
      metricName: 'pH',
      triggeredValue: 6.5,
      minValue: 7,
      maxValue: 8.5,
      direction: 'LOW',
    });

    expect(alertRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      pondId: 'pond-1',
      deviceId: 'device-1',
      metricName: 'pH',
      triggeredValue: 6.5,
      alertLevel: AlertLevel.WARNING,
      status: AlertStatus.ACTIVE,
      message: expect.stringContaining('thấp hơn ngưỡng 7'),
    }));
    expect(result.alertId).toBe('alert-1');
  });

  it('describes high threshold violations in Vietnamese', async () => {
    await service.createThresholdAlert({
      pondId: 'pond-1',
      deviceId: 'device-1',
      metricName: 'DO',
      triggeredValue: 10,
      minValue: 4,
      maxValue: 8,
      direction: 'HIGH',
    });

    expect(alertRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('cao hơn ngưỡng 8'),
    }));
  });
});
