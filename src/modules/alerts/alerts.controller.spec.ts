import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../../common/enums/role.enum.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor.js';
import { AlertsController } from './alerts.controller.js';

describe('AlertsController response standardization', () => {
  const makeController = () => {
    const alertsService = {
      findAll: vi.fn(),
      resolveAlert: vi.fn(),
    };
    return {
      controller: new AlertsController(alertsService as any),
      alertsService,
    };
  };

  const wrapWithInterceptor = async <T>(
    method: string,
    handlerName: keyof AlertsController,
    value: T,
  ) => {
    const reflector = new Reflector();
    const interceptor = new TransformInterceptor(reflector);
    const context = {
      getHandler: () => AlertsController.prototype[handlerName],
      getClass: () => AlertsController,
      switchToHttp: () => ({
        getRequest: () => ({ method }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as any;
    return firstValueFrom(
      interceptor.intercept(context, { handle: () => of(value) }),
    );
  };

  it('registers JwtAuthGuard on AlertsController', () => {
    expect(Reflect.getMetadata('__guards__', AlertsController)).toContain(
      JwtAuthGuard,
    );
  });

  it('findAll returns unwrapped paginated payload with totalPages and single-envelopes under TransformInterceptor', async () => {
    const { controller, alertsService } = makeController();
    const rows = [{ alertId: 'alert-1' }, { alertId: 'alert-2' }];
    alertsService.findAll.mockResolvedValue({ data: rows, total: 45 });

    const res = await controller.findAll(
      { page: 2, limit: 20 },
      { userId: 'user-1', role: Role.MANAGER } as any,
    );

    expect(alertsService.findAll).toHaveBeenCalledWith(
      { page: 2, limit: 20 },
      'user-1',
      Role.MANAGER,
    );
    expect(res).toEqual({
      data: rows,
      total: 45,
      page: 2,
      limit: 20,
      totalPages: 3,
    });
    expect(res).not.toHaveProperty('success');

    const enveloped = await wrapWithInterceptor('GET', 'findAll', res);
    expect(enveloped).toEqual({
      success: true,
      statusCode: 200,
      message: 'Lấy dữ liệu thành công',
      data: {
        data: rows,
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
      },
    });
  });

  it('findAll defaults to page=1 and limit=20', async () => {
    const { controller, alertsService } = makeController();
    alertsService.findAll.mockResolvedValue({ data: [], total: 0 });

    const res = await controller.findAll(
      {},
      { userId: 'user-1', role: Role.ADMIN } as any,
    );

    expect(res).toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
  });

  it('resolve returns resolved alert directly and preserves Alert.message under TransformInterceptor via @ResponseMessage', async () => {
    const { controller, alertsService } = makeController();
    const resolvedAlert = {
      alertId: 'alert-1',
      status: 'RESOLVED',
      message: 'Chỉ số DO đo được 2.5, thấp hơn ngưỡng 4 (khoảng cho phép 4 - 8).',
      resolutionNote: 'Đã kiểm tra máy sục khí',
    };
    alertsService.resolveAlert.mockResolvedValue(resolvedAlert);

    const res = await controller.resolve(
      'alert-1',
      { resolutionNote: 'Đã kiểm tra máy sục khí' },
      { userId: 'user-1', role: Role.FARMER } as any,
    );

    expect(alertsService.resolveAlert).toHaveBeenCalledWith(
      'alert-1',
      'user-1',
      { resolutionNote: 'Đã kiểm tra máy sục khí' },
      Role.FARMER,
    );
    expect(res).toEqual(resolvedAlert);
    expect(res).not.toHaveProperty('success');

    const enveloped = await wrapWithInterceptor('PATCH', 'resolve', res);
    expect(enveloped).toEqual({
      success: true,
      statusCode: 200,
      message: 'Đã giải quyết cảnh báo thành công',
      data: resolvedAlert,
    });
    expect(enveloped.data.message).toBe(
      'Chỉ số DO đo được 2.5, thấp hơn ngưỡng 4 (khoảng cho phép 4 - 8).',
    );
  });
});
