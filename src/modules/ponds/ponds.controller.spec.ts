import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { Role } from '../../common/enums/role.enum.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PondsController } from './ponds.controller.js';
import { PondsService } from './ponds.service.js';

describe('PondsController authorization metadata', () => {
  const controller = new PondsController({} as PondsService);
  const rolesGuard = new RolesGuard(new Reflector());

  const createContext = (
    handler: Function,
    role: Role,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PondsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as ExecutionContext;

  const pondManagementHandlers = [
    controller.createPond,
    controller.updatePond,
    controller.deletePond,
    controller.createThreshold,
    controller.updateThreshold,
    controller.deleteThreshold,
  ];

  it.each(pondManagementHandlers)(
    'Pond và Threshold mutation yêu cầu chính xác ADMIN và MANAGER',
    (handler) => {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        Role.ADMIN,
        Role.MANAGER,
      ]);
    },
  );

  it.each(pondManagementHandlers)(
    'ADMIN được phép quản lý pond và thresholds qua RolesGuard superuser behavior',
    (handler) => {
      expect(rolesGuard.canActivate(createContext(handler, Role.ADMIN))).toBe(
        true,
      );
    },
  );

  it.each(pondManagementHandlers)(
    'MANAGER được phép quản lý pond và thresholds',
    (handler) => {
      expect(rolesGuard.canActivate(createContext(handler, Role.MANAGER))).toBe(
        true,
      );
    },
  );

  it.each(pondManagementHandlers)(
    'FARMER bị chặn khi quản lý pond và thresholds',
    (handler) => {
      expect(() =>
        rolesGuard.canActivate(createContext(handler, Role.FARMER)),
      ).toThrow(ForbiddenException);
    },
  );

  it.each([controller.findAllPonds, controller.findPondById, controller.findThresholdsByPond])(
    'GET pond và thresholds không bị khóa bằng role decorator',
    (handler) => {
      expect(rolesGuard.canActivate(createContext(handler, Role.FARMER))).toBe(
        true,
      );
    },
  );

  it('manual test log không bị khóa bằng role decorator', () => {
    expect(
      rolesGuard.canActivate(createContext(controller.createManualLog, Role.FARMER)),
    ).toBe(true);
  });
});
