import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

describe('DevicesController authorization metadata', () => {
  const controller = new DevicesController({} as DevicesService);
  const rolesGuard = new RolesGuard(new Reflector());

  const createContext = (
    handler: Function,
    role: Role,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => DevicesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as ExecutionContext;

  const mutationHandlers = [
    ['POST', controller.createDevice],
    ['PATCH updateDevice', controller.updateDevice],
    ['PATCH assignToPond', controller.assignToPond],
    ['PATCH updateStatus', controller.updateStatus],
    ['DELETE', controller.deleteDevice],
  ] as const;

  const getHandlers = [
    ['GET collection', controller.findAllDevices],
    ['GET detail', controller.findDeviceById],
  ];

  it.each(mutationHandlers)(
    '%s metadata yêu cầu chính xác ADMIN và MANAGER',
    (_method, handler) => {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        Role.ADMIN,
        Role.MANAGER,
      ]);
    },
  );

  it.each(mutationHandlers)('ADMIN được phép %s', (_method, handler) => {
    expect(rolesGuard.canActivate(createContext(handler, Role.ADMIN))).toBe(
      true,
    );
  });

  it.each(mutationHandlers)('MANAGER được phép %s', (_method, handler) => {
    expect(rolesGuard.canActivate(createContext(handler, Role.MANAGER))).toBe(
      true,
    );
  });

  it.each(mutationHandlers)('FARMER bị chặn %s', (_method, handler) => {
    expect(() =>
      rolesGuard.canActivate(createContext(handler, Role.FARMER)),
    ).toThrow(ForbiddenException);
  });

  it.each(getHandlers)(
    '%s không có mutation-role metadata và FARMER đi qua RolesGuard',
    (_endpoint, handler) => {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(rolesGuard.canActivate(createContext(handler, Role.FARMER))).toBe(
        true,
      );
    },
  );
});
