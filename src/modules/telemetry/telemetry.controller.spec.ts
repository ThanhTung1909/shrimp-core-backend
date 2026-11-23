import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../../common/enums/role.enum.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { TelemetryController } from './telemetry.controller.js';

describe('TelemetryController security boundary', () => {
  const makeController = () => {
    const telemetryService = {
      assertDeviceReadAccess: vi.fn().mockResolvedValue(undefined),
      getLatestByDeviceId: vi.fn(),
      getHistoryByDeviceId: vi.fn(),
    };
    return { controller: new TelemetryController(telemetryService as any), telemetryService };
  };

  it('registers JwtAuthGuard for every HTTP telemetry route', () => {
    expect(Reflect.getMetadata('__guards__', TelemetryController)).toContain(JwtAuthGuard);
  });

  it('authorizes the device pond before requesting latest telemetry', async () => {
    const { controller, telemetryService } = makeController();
    telemetryService.getLatestByDeviceId.mockResolvedValue({ id: 'row-1' });

    await controller.getLatest('device-a', 'farmer-a', Role.FARMER);

    expect(telemetryService.assertDeviceReadAccess).toHaveBeenCalledWith('device-a', 'farmer-a', Role.FARMER);
    expect(telemetryService.getLatestByDeviceId).toHaveBeenCalledWith('device-a');
  });

  it('does not query telemetry when pond authorization rejects the request', async () => {
    const { controller, telemetryService } = makeController();
    telemetryService.assertDeviceReadAccess.mockRejectedValueOnce(new ForbiddenException());

    await expect(controller.getHistory('device-b', {}, 'farmer-a', Role.FARMER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(telemetryService.getHistoryByDeviceId).not.toHaveBeenCalled();
  });
});
