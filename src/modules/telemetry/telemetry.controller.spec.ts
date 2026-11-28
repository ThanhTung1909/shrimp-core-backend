import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../../common/enums/role.enum.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor.js';
import { TelemetryController } from './telemetry.controller.js';

describe('TelemetryController security boundary & response standardization', () => {
  const makeController = () => {
    const telemetryService = {
      assertDeviceReadAccess: vi.fn().mockResolvedValue(undefined),
      getLatestByDeviceId: vi.fn(),
      getHistoryByDeviceId: vi.fn(),
    };
    return { controller: new TelemetryController(telemetryService as any), telemetryService };
  };

  const wrapWithInterceptor = async <T>(method: string, value: T) => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const interceptor = new TransformInterceptor(reflector);
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ method }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as any;
    return firstValueFrom(interceptor.intercept(context, { handle: () => of(value) }));
  };

  it('registers JwtAuthGuard for every HTTP telemetry route', () => {
    expect(Reflect.getMetadata('__guards__', TelemetryController)).toContain(JwtAuthGuard);
  });

  it('authorizes the device pond before requesting latest telemetry and returns unwrapped record', async () => {
    const { controller, telemetryService } = makeController();
    const latest = { id: 'row-1', temperature: 28.5 };
    telemetryService.getLatestByDeviceId.mockResolvedValue(latest);

    const res = await controller.getLatest('device-a', 'farmer-a', Role.FARMER);

    expect(telemetryService.assertDeviceReadAccess).toHaveBeenCalledWith('device-a', 'farmer-a', Role.FARMER);
    expect(telemetryService.getLatestByDeviceId).toHaveBeenCalledWith('device-a');
    expect(res).toEqual(latest);
    expect(res).not.toHaveProperty('success');

    const enveloped = await wrapWithInterceptor('GET', res);
    expect(enveloped).toEqual({
      success: true,
      statusCode: 200,
      message: 'Lấy dữ liệu thành công',
      data: latest,
    });
  });

  it('throws NotFoundException when latest telemetry does not exist', async () => {
    const { controller, telemetryService } = makeController();
    telemetryService.getLatestByDeviceId.mockResolvedValue(null);

    await expect(controller.getLatest('device-a', 'farmer-a', Role.FARMER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns unwrapped paginated payload for getHistory compatible with TransformInterceptor', async () => {
    const { controller, telemetryService } = makeController();
    const rows = [{ id: 'row-1' }, { id: 'row-2' }];
    telemetryService.getHistoryByDeviceId.mockResolvedValue({ data: rows, total: 205 });

    const res = await controller.getHistory('device-a', { page: 2, limit: 100 }, 'farmer-a', Role.FARMER);

    expect(res).toEqual({
      data: rows,
      total: 205,
      page: 2,
      limit: 100,
      totalPages: 3,
    });
    expect(res).not.toHaveProperty('success');

    const enveloped = await wrapWithInterceptor('GET', res);
    expect(enveloped).toEqual({
      success: true,
      statusCode: 200,
      message: 'Lấy dữ liệu thành công',
      data: {
        data: rows,
        total: 205,
        page: 2,
        limit: 100,
        totalPages: 3,
      },
    });
  });

  it('does not query telemetry when pond authorization rejects the request', async () => {
    const { controller, telemetryService } = makeController();
    telemetryService.assertDeviceReadAccess.mockRejectedValueOnce(new ForbiddenException());

    await expect(controller.getHistory('device-b', {}, 'farmer-a', Role.FARMER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(telemetryService.getHistoryByDeviceId).not.toHaveBeenCalled();
  });
});
