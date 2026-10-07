import { ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { EsmsService } from '../src/common/esms/esms.service.js';
import { Role } from '../src/common/enums/role.enum.js';
import { UsersController } from '../src/modules/users/users.controller.js';

const createUsersService = () => {
  const repository = {
    findOne: vi.fn(),
    create: vi.fn((data) => data),
    save: vi.fn(async (data) => ({ userId: 'created-user', ...data })),
  };

  return new UsersService(repository as never, { clear: vi.fn() } as never);
};

describe('P0 role-escalation protections', () => {
  it('rejects MANAGER creating ADMIN through the auth registration service', async () => {
    const usersService = createUsersService();
    const authService = new AuthService(
      usersService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const authController = new AuthController(authService, usersService);

    await expect(
      authController.register(
        Role.MANAGER,
        {
          fullName: 'Attempted Admin',
          phoneNumber: '0900000001',
          email: 'attempt@example.com',
          role: Role.ADMIN,
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects MANAGER creating ADMIN through users service but permits FARMER creation', async () => {
    const usersService = createUsersService();

    const usersController = new UsersController(usersService);

    await expect(
      usersController.createUser(Role.MANAGER, {
        fullName: 'Attempted Admin',
        phoneNumber: '0900000002',
        password: 'Password123!',
        role: Role.ADMIN,
      }),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      usersService.createUserByAdmin(Role.MANAGER, {
        fullName: 'Farmer User',
        phoneNumber: '0900000003',
        password: 'Password123!',
        role: Role.FARMER,
      }),
    ).resolves.toMatchObject({ role: Role.FARMER });
  });

  it.each([Role.FARMER, Role.MANAGER])(
    'rejects MANAGER promoting %s to ADMIN',
    async (targetRole) => {
      const usersService = createUsersService();
      vi.spyOn(usersService, 'findById').mockResolvedValue({
        userId: 'target',
        role: targetRole,
      } as never);

      await expect(
        usersService.adminUpdateUser(Role.MANAGER, 'target', {
          role: Role.ADMIN,
        }),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it.each(['update', 'delete'] as const)(
    'rejects MANAGER attempting to %s an existing ADMIN',
    async (operation) => {
      const usersService = createUsersService();
      vi.spyOn(usersService, 'findById').mockResolvedValue({
        userId: 'admin-target',
        role: Role.ADMIN,
      } as never);

      const request =
        operation === 'update'
          ? usersService.adminUpdateUser(Role.MANAGER, 'admin-target', {
              fullName: 'Changed',
            })
          : usersService.deleteUser(Role.MANAGER, 'admin-target');

      await expect(request).rejects.toThrow(ForbiddenException);
    },
  );
});

describe('P0 must-change-password guard', () => {
  afterEach(() => vi.restoreAllMocks());

  const contextFor = (mustChangePassword: boolean) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { mustChangePassword } }),
      }),
    }) as never;

  const mockAuthentication = () => {
    const parent = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
      canActivate: (context: unknown) => Promise<boolean>;
    };
    return vi.spyOn(parent, 'canActivate').mockResolvedValue(true);
  };

  it('allows forced-change users on explicitly marked recovery routes', async () => {
    mockAuthentication();
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
    } as unknown as Reflector;

    await expect(
      new JwtAuthGuard(reflector).canActivate(contextFor(true)),
    ).resolves.toBe(true);
  });

  it('denies forced-change users on ordinary protected routes', async () => {
    mockAuthentication();
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;

    await expect(
      new JwtAuthGuard(reflector).canActivate(contextFor(true)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('leaves ordinary users unaffected', async () => {
    mockAuthentication();
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;

    await expect(
      new JwtAuthGuard(reflector).canActivate(contextFor(false)),
    ).resolves.toBe(true);
  });
});

describe('P0 OTP log redaction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const loggerSpies = () => [
    vi.spyOn(Logger.prototype, 'log'),
    vi.spyOn(Logger.prototype, 'warn'),
    vi.spyOn(Logger.prototype, 'error'),
    vi.spyOn(Logger.prototype, 'debug'),
    vi.spyOn(Logger.prototype, 'verbose'),
  ];

  const expectOtpAbsentFromLogs = (otp: string, spies: ReturnType<typeof loggerSpies>) => {
    const logged = spies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(logged).not.toContain(otp);
  };

  const service = () =>
    new EsmsService({
      get: (name: string) =>
        ({
          ESMS_API_KEY: 'test-api-key',
          ESMS_SECRET_KEY: 'test-secret-key',
        })[name],
    } as never);

  it('never logs OTP digits on provider success', async () => {
    const otp = '654321';
    const spies = loggerSpies();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue('{"CodeResult":"100","SMSID":"ref-1"}'),
      }),
    );

    await service().sendSMS('0900000000', otp);
    expectOtpAbsentFromLogs(otp, spies);
  });

  it('never logs OTP digits when the provider rejects a request', async () => {
    const otp = '654321';
    const spies = loggerSpies();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        text: vi
          .fn()
          .mockResolvedValue(`{"CodeResult":"500","ErrorMessage":"rejected ${otp}"}`),
      }),
    );

    await expect(service().sendSMS('0900000000', otp)).rejects.toThrow();
    expectOtpAbsentFromLogs(otp, spies);
  });
});
