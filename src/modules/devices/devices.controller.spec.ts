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
    controller.createDevice,
    controller.updateDevice,
    controller.deleteDevice,
  ];

  it.each(mutationHandlers)(
    'mutation yêu cầu chính xác MANAGER',
    (handler) => {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([Role.MANAGER]);
    },
  );

  it.each(mutationHandlers)('MANAGER được phép mutation', (handler) => {
    expect(rolesGuard.canActivate(createContext(handler, Role.MANAGER))).toBe(
      true,
    );
  });

  it.each(mutationHandlers)('FARMER bị chặn mutation', (handler) => {
    expect(() =>
      rolesGuard.canActivate(createContext(handler, Role.FARMER)),
    ).toThrow(ForbiddenException);
  });

  it.each([controller.findAllDevices, controller.findDeviceById])(
    'GET không có mutation-role restriction',
    (handler) => {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(rolesGuard.canActivate(createContext(handler, Role.FARMER))).toBe(
        true,
      );
    },
  );
});
