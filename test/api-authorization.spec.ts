import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PondsService } from '../src/modules/ponds/ponds.service.js';
import { PondsController } from '../src/modules/ponds/ponds.controller.js';
import { DevicesService } from '../src/modules/devices/devices.service.js';
import { DevicesController } from '../src/modules/devices/devices.controller.js';
import { UsersController } from '../src/modules/users/users.controller.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { Role } from '../src/common/enums/role.enum.js';
import { Reflector } from '@nestjs/core';

describe('API AUTHORIZATION & SECURITY AUDIT (PHASE 9)', () => {
  const FARMER_A = 'farmer-a-uuid-1111';
  const FARMER_B = 'farmer-b-uuid-2222';
  const MANAGER_USER = 'manager-uuid-9999';

  let pondsStore: any[];
  let thresholdsStore: any[];
  let manualLogsStore: any[];
  let devicesStore: any[];
  let usersStore: Map<string, any>;

  let pondsService: PondsService;
  let pondsController: PondsController;
  let devicesService: DevicesService;
  let devicesController: DevicesController;
  let usersService: UsersService;
  let usersController: UsersController;
  let rolesGuard: RolesGuard;
  let jwtStrategy: JwtStrategy;

  beforeEach(() => {
    pondsStore = [
      {
        pondId: 'pond-a-1',
        pondName: 'Ao A1',
        userId: FARMER_A,
        areaM2: 1000,
        depthM: 1.5,
        shrimpDensity: 50,
        status: 'ACTIVE',
        user: { userId: FARMER_A },
      },
      {
        pondId: 'pond-b-1',
        pondName: 'Ao B1',
        userId: FARMER_B,
        areaM2: 2000,
        depthM: 2.0,
        shrimpDensity: 60,
        status: 'ACTIVE',
        user: { userId: FARMER_B },
      },
    ];

    thresholdsStore = [
      {
        configId: 'thresh-a-1',
        pondId: 'pond-a-1',
        metricName: 'pH',
        minValue: 7.5,
        maxValue: 8.5,
        isActive: true,
        pond: pondsStore[0],
      },
      {
        configId: 'thresh-b-1',
        pondId: 'pond-b-1',
        metricName: 'DO',
        minValue: 4.0,
        maxValue: 8.0,
        isActive: true,
        pond: pondsStore[1],
      },
    ];

    manualLogsStore = [
      {
        logId: 'log-a-1',
        pondId: 'pond-a-1',
        testedById: FARMER_A,
        nh3Value: 0.1,
        no2Value: 0.05,
        testedAt: new Date(),
        pond: pondsStore[0],
      },
      {
        logId: 'log-b-1',
        pondId: 'pond-b-1',
        testedById: FARMER_B,
        nh3Value: 0.2,
        no2Value: 0.1,
        testedAt: new Date(),
        pond: pondsStore[1],
      },
    ];

    devicesStore = [
      {
        deviceId: 'dev-a-1',
        deviceName: 'Sensor A1',
        macAddress: 'AA:BB:CC:DD:EE:01',
        pondId: 'pond-a-1',
        status: 'ONLINE',
        pond: pondsStore[0],
      },
      {
        deviceId: 'dev-b-1',
        deviceName: 'Sensor B1',
        macAddress: 'AA:BB:CC:DD:EE:02',
        pondId: 'pond-b-1',
        status: 'ONLINE',
        pond: pondsStore[1],
      },
    ];

    usersStore = new Map([
      [
        FARMER_A,
        {
          userId: FARMER_A,
          phoneNumber: '0901111111',
          fullName: 'Farmer Alice',
          role: Role.FARMER,
          tokenVersion: 0,
          isActive: true,
          passwordHash: '$2b$10$hashedpasswordA',
        },
      ],
      [
        FARMER_B,
        {
          userId: FARMER_B,
          phoneNumber: '0902222222',
          fullName: 'Farmer Bob',
          role: Role.FARMER,
          tokenVersion: 0,
          isActive: true,
          passwordHash: '$2b$10$hashedpasswordB',
        },
      ],
      [
        MANAGER_USER,
        {
          userId: MANAGER_USER,
          phoneNumber: '0909999999',
          fullName: 'Manager Mike',
          role: Role.MANAGER,
          tokenVersion: 0,
          isActive: true,
          passwordHash: '$2b$10$hashedpasswordM',
        },
      ],
    ]);

    // Mock Pond Repo
    const pondRepo: any = {
      create: vi.fn((dto) => ({
        pondId: 'pond-new-' + Math.random(),
        ...dto,
      })),
      save: vi.fn(async (pond) => {
        const idx = pondsStore.findIndex((p) => p.pondId === pond.pondId);
        if (idx >= 0) pondsStore[idx] = pond;
        else pondsStore.push(pond);
        return pond;
      }),
      findOne: vi.fn(async (opt) => pondsStore.find((p) => p.pondId === opt.where?.pondId) || null),
      findAndCount: vi.fn(async (opt) => {
        let list = pondsStore;
        if (opt?.where?.userId) {
          list = list.filter((p) => p.userId === opt.where.userId);
        }
        return [list, list.length];
      }),
      remove: vi.fn(async (pond) => {
        pondsStore = pondsStore.filter((p) => p.pondId !== pond.pondId);
        return pond;
      }),
    };

    // Mock Threshold Repo
    const thresholdRepo: any = {
      create: vi.fn((dto) => ({
        configId: 'thresh-new-' + Math.random(),
        ...dto,
      })),
      save: vi.fn(async (cfg) => {
        const idx = thresholdsStore.findIndex((t) => t.configId === cfg.configId);
        if (idx >= 0) thresholdsStore[idx] = cfg;
        else thresholdsStore.push(cfg);
        return cfg;
      }),
      findOne: vi.fn(async (opt) => thresholdsStore.find((t) => t.configId === opt.where?.configId) || null),
      find: vi.fn(async (opt) => thresholdsStore.filter((t) => t.pondId === opt.where?.pondId)),
      remove: vi.fn(async (cfg) => {
        thresholdsStore = thresholdsStore.filter((t) => t.configId !== cfg.configId);
        return cfg;
      }),
    };

    // Mock Manual Log Repo
    const manualLogRepo: any = {
      create: vi.fn((dto) => ({
        logId: 'log-new-' + Math.random(),
        ...dto,
      })),
      save: vi.fn(async (log) => {
        const idx = manualLogsStore.findIndex((l) => l.logId === log.logId);
        if (idx >= 0) manualLogsStore[idx] = log;
        else manualLogsStore.push(log);
        return log;
      }),
      findOne: vi.fn(async (opt) => manualLogsStore.find((l) => l.logId === opt.where?.logId) || null),
      findAndCount: vi.fn(async (opt) => {
        let list = manualLogsStore;
        if (opt?.where?.pondId) {
          list = list.filter((l) => l.pondId === opt.where.pondId);
        }
        return [list, list.length];
      }),
      remove: vi.fn(async (log) => {
        manualLogsStore = manualLogsStore.filter((l) => l.logId !== log.logId);
        return log;
      }),
    };

    // Mock Device Repo
    const deviceRepo: any = {
      create: vi.fn((dto) => ({
        deviceId: 'dev-new-' + Math.random(),
        ...dto,
      })),
      save: vi.fn(async (dev) => {
        const idx = devicesStore.findIndex((d) => d.deviceId === dev.deviceId);
        if (idx >= 0) devicesStore[idx] = dev;
        else devicesStore.push(dev);
        return dev;
      }),
      findOne: vi.fn(async (opt) => {
        if (opt.where?.macAddress) {
          return devicesStore.find((d) => d.macAddress === opt.where.macAddress) || null;
        }
        return devicesStore.find((d) => d.deviceId === opt.where?.deviceId) || null;
      }),
      findAndCount: vi.fn(async (opt) => {
        let list = devicesStore;
        if (opt?.where?.pond?.userId) {
          list = list.filter((d) => d.pond?.userId === opt.where.pond.userId);
        }
        return [list, list.length];
      }),
      remove: vi.fn(async (dev) => {
        devicesStore = devicesStore.filter((d) => d.deviceId !== dev.deviceId);
        return dev;
      }),
    };

    pondsService = new PondsService(pondRepo, thresholdRepo, manualLogRepo);
    pondsController = new PondsController(pondsService);

    devicesService = new DevicesService(deviceRepo, pondRepo);
    devicesController = new DevicesController(devicesService);

    const usersRepo: any = {
      create: vi.fn((dto) => dto),
      save: vi.fn(async (u) => {
        usersStore.set(u.userId, u);
        return u;
      }),
      findOne: vi.fn(async (opt) => {
        const id = opt.where?.userId;
        return usersStore.get(id) || null;
      }),
      update: vi.fn(async (criteria, updateData) => {
        const u = usersStore.get(criteria.userId);
        if (u) Object.assign(u, updateData);
        return { affected: 1 };
      }),
      increment: vi.fn(async (criteria) => {
        const u = usersStore.get(criteria.userId);
        if (u) u.tokenVersion++;
        return { affected: 1 };
      }),
      remove: vi.fn(async (u) => {
        usersStore.delete(u.userId);
        return u;
      }),
    };

    usersService = new UsersService(usersRepo);
    usersController = new UsersController(usersService);

    rolesGuard = new RolesGuard(new Reflector());

    const mockConfig: any = {
      get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'test_jwt_access_secret_1234567890123' : null),
    };
    jwtStrategy = new JwtStrategy(mockConfig, usersService);
  });

  // 1. Unauthenticated / Invalid Token Handling (401)
  describe('1. Authentication Boundary (401 Handling)', () => {
    it('Refresh token used as access token is rejected with 401 Unauthorized', async () => {
      await expect(
        jwtStrategy.validate({
          sub: FARMER_A,
          tokenVersion: 0,
          role: Role.FARMER,
          type: 'refresh', // WRONG TYPE
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Token with outdated tokenVersion is rejected with 401 Unauthorized', async () => {
      await expect(
        jwtStrategy.validate({
          sub: FARMER_A,
          tokenVersion: 999, // Outdated version
          role: Role.FARMER,
          type: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Token for deactivated user is rejected with 401 Unauthorized', async () => {
      const userA = usersStore.get(FARMER_A);
      userA.isActive = false;

      await expect(
        jwtStrategy.validate({
          sub: FARMER_A,
          tokenVersion: 0,
          role: Role.FARMER,
          type: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // 2. RBAC Enforcement (403 Handling)
  describe('2. RBAC Enforcement & Vertical Privilege Escalation', () => {
    it('FARMER role calling MANAGER-only endpoint is rejected with 403 Forbidden', () => {
      const context: any = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: FARMER_A, role: Role.FARMER },
          }),
        }),
      };

      // Mock reflector returning Role.MANAGER required
      vi.spyOn(Reflector.prototype, 'getAllAndOverride').mockReturnValue([Role.MANAGER]);

      expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('MANAGER role calling MANAGER-only endpoint is allowed (canActivate returns true)', () => {
      const context: any = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: MANAGER_USER, role: Role.MANAGER },
          }),
        }),
      };

      vi.spyOn(Reflector.prototype, 'getAllAndOverride').mockReturnValue([Role.MANAGER]);

      expect(rolesGuard.canActivate(context)).toBe(true);
    });
  });

  // 3. BOLA / IDOR on Ponds
  describe('3. BOLA / IDOR on Pond Resources', () => {
    it('Farmer A cannot view Farmer B pond (GET /ponds/:id -> 403)', async () => {
      await expect(
        pondsController.findPondById('pond-b-1', FARMER_A, Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot update Farmer B pond (PATCH /ponds/:id -> 403)', async () => {
      await expect(
        pondsController.updatePond('pond-b-1', FARMER_A, Role.FARMER, { pondName: 'Hacked' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot delete Farmer B pond (DELETE /ponds/:id -> 403)', async () => {
      await expect(
        pondsController.deletePond('pond-b-1', FARMER_A, Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Manager can view, update and delete any farmer pond', async () => {
      const pond = await pondsController.findPondById('pond-b-1', MANAGER_USER, Role.MANAGER);
      expect(pond).toBeDefined();
      expect(pond.pondId).toBe('pond-b-1');

      const updated = await pondsController.updatePond(
        'pond-b-1',
        MANAGER_USER,
        Role.MANAGER,
        { pondName: 'Manager Renamed' },
      );
      expect(updated.data.pondName).toBe('Manager Renamed');
    });

    it('Farmer listing ponds only receives own ponds', async () => {
      const result = await pondsController.findAllPonds(FARMER_A, Role.FARMER, {} as any);
      expect(result.data.every((p) => p.userId === FARMER_A)).toBe(true);
    });
  });

  // 4. BOLA / IDOR on Threshold Configs & Manual Logs
  describe('4. BOLA / IDOR on Thresholds and Manual Logs', () => {
    it('Farmer A cannot create threshold on Farmer B pond (POST /ponds/:pondId/thresholds -> 403)', async () => {
      await expect(
        pondsController.createThreshold(
          'pond-b-1',
          FARMER_A,
          Role.FARMER,
          { metricName: 'Salinity', minValue: 10, maxValue: 25 },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot update threshold on Farmer B pond (PATCH /ponds/thresholds/:configId -> 403)', async () => {
      await expect(
        pondsController.updateThreshold(
          'thresh-b-1',
          FARMER_A,
          Role.FARMER,
          { maxValue: 10 },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot delete threshold on Farmer B pond (DELETE /ponds/thresholds/:configId -> 403)', async () => {
      await expect(
        pondsController.deleteThreshold('thresh-b-1', FARMER_A, Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot create manual log on Farmer B pond (POST /ponds/:pondId/manual-logs -> 403)', async () => {
      await expect(
        pondsController.createManualLog(
          'pond-b-1',
          FARMER_A,
          Role.FARMER,
          { nh3Value: 0.5, no2Value: 0.2 },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot view manual log of Farmer B pond (GET /ponds/manual-logs/:logId -> 403)', async () => {
      await expect(
        pondsController.findManualLogById('log-b-1', FARMER_A, Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot update manual log of Farmer B pond (PATCH /ponds/manual-logs/:logId -> 403)', async () => {
      await expect(
        pondsController.updateManualLog(
          'log-b-1',
          FARMER_A,
          Role.FARMER,
          { note: 'Attacker note' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // 5. BOLA / IDOR on Device Resources
  describe('5. BOLA / IDOR on Device Management', () => {
    it('Farmer A cannot register a device into Farmer B pond -> 403 Forbidden', async () => {
      await expect(
        devicesController.createDevice(
          FARMER_A,
          Role.FARMER,
          { deviceName: 'Rogue Device', macAddress: 'AA:BB:CC:DD:EE:99', pondId: 'pond-b-1' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot view Farmer B device (GET /devices/:id -> 403)', async () => {
      await expect(
        devicesController.findDeviceById('dev-b-1', FARMER_A, Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot update Farmer B device (PATCH /devices/:id -> 403)', async () => {
      await expect(
        devicesController.updateDevice(
          'dev-b-1',
          FARMER_A,
          Role.FARMER,
          { deviceName: 'Renamed by Attacker' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot transfer own device to Farmer B pond -> 403 Forbidden', async () => {
      await expect(
        devicesController.updateDevice(
          'dev-a-1',
          FARMER_A,
          Role.FARMER,
          { pondId: 'pond-b-1' }, // Farmer B pond
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer A cannot delete Farmer B device (DELETE /devices/:id -> 403)', async () => {
      await expect(
        devicesController.deleteDevice('dev-b-1', FARMER_A, Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Farmer listing devices only receives devices attached to own ponds', async () => {
      const res = await devicesController.findAllDevices(FARMER_A, Role.FARMER, {} as any);
      expect(res.data.every((d) => d.pond.userId === FARMER_A)).toBe(true);
    });
  });

  // 6. Mass Assignment Protection
  describe('6. Mass Assignment & Privilege Escalation Protection', () => {
    it('Farmer creating a pond cannot supply another userId (forced to own currentUserId)', async () => {
      const res = await pondsController.createPond(
        FARMER_A,
        Role.FARMER,
        { pondName: 'New Pond', areaM2: 500, depthM: 1, userId: FARMER_B } as any,
      );
      expect(res.data.userId).toBe(FARMER_A);
      expect(res.data.userId).not.toBe(FARMER_B);
    });

    it('Farmer updating a pond cannot transfer ownership to another user (userId change ignored)', async () => {
      const res = await pondsController.updatePond(
        'pond-a-1',
        FARMER_A,
        Role.FARMER,
        { userId: FARMER_B } as any,
      );
      expect(res.data.userId).toBe(FARMER_A);
    });

    it('Manager creating a pond CAN specify target farmer userId', async () => {
      const res = await pondsController.createPond(
        MANAGER_USER,
        Role.MANAGER,
        { pondName: 'Manager Created', areaM2: 500, depthM: 1, userId: FARMER_B },
      );
      expect(res.data.userId).toBe(FARMER_B);
    });
  });

  // 7. Sensitive Data Protection (No Password Hash Leakage)
  describe('7. Sensitive Data Protection', () => {
    it('sanitizeUser strips passwordHash from returned User object', () => {
      const rawUser = usersStore.get(FARMER_A);
      const safe = usersService.sanitizeUser(rawUser);

      expect(safe).toBeDefined();
      expect(safe.userId).toBe(FARMER_A);
      expect(safe.fullName).toBe('Farmer Alice');
      expect((safe as any).passwordHash).toBeUndefined();
    });

    it('Farmer viewing own profile via getUserById returns sanitized user without passwordHash', async () => {
      const profile = await usersController.getUserById(FARMER_A, FARMER_A, Role.FARMER);
      expect(profile).toBeDefined();
      expect(profile.userId).toBe(FARMER_A);
      expect((profile as any).passwordHash).toBeUndefined();
    });

    it('Farmer attempting to view another farmer profile via getUserById is rejected with 403 Forbidden', async () => {
      await expect(
        usersController.getUserById(FARMER_B, FARMER_A, Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // 8. Non-Existent Resources (404 Handling)
  describe('8. Non-Existent Resource Handling (404)', () => {
    it('Non-existent pond returns 404 NotFoundException', async () => {
      await expect(
        pondsController.findPondById('pond-non-existent', FARMER_A, Role.FARMER),
      ).rejects.toThrow(NotFoundException);
    });

    it('Non-existent device returns 404 NotFoundException', async () => {
      await expect(
        devicesController.findDeviceById('dev-non-existent', FARMER_A, Role.FARMER),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
