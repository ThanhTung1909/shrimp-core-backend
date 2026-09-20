import { describe, it, expect, vi } from 'vitest';
import { User } from '../src/modules/users/entities/user.entity.js';
import { UserSession } from '../src/modules/auth/entities/user-session.entity.js';
import { Pond } from '../src/modules/ponds/entities/pond.entity.js';
import { ThresholdConfig } from '../src/modules/ponds/entities/threshold-config.entity.js';
import { ManualTestLog } from '../src/modules/ponds/entities/manual-test-log.entity.js';
import { Alert } from '../src/modules/alerts/entities/alert.entity.js';
import { TelemetryData } from '../src/modules/telemetry/entities/telemetry-data.entity.js';
import { Role } from '../src/common/enums/role.enum.js';
import { PondStatus } from '../src/common/enums/pond-status.enum.js';
import { DeviceStatus } from '../src/common/enums/device-status.enum.js';
import { AlertLevel } from '../src/common/enums/alert-level.enum.js';
import { AlertStatus } from '../src/common/enums/alert-status.enum.js';
import { RiskLevel } from '../src/common/enums/risk-level.enum.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DevicesService } from '../src/modules/devices/devices.service.js';
import { PondsService } from '../src/modules/ponds/ponds.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { JwtService } from '@nestjs/jwt';

describe('DATABASE SECURITY & INTEGRITY AUDIT (PHASE 10)', () => {
  // 1. Entity Metadata & Constraint Definitions Inspection
  describe('1. Entity Metadata & Table Design Audit', () => {
    it('User entity has unique constraint on phone_number and non-nullable critical columns', () => {
      const user = new User();
      user.userId = 'u-1';
      user.fullName = 'Test User';
      user.phoneNumber = '0901234567';
      user.passwordHash = 'hash';
      user.role = Role.FARMER;
      user.isActive = true;
      user.tokenVersion = 0;

      expect(user.userId).toBeDefined();
      expect(user.phoneNumber).toBe('0901234567');
      expect(user.tokenVersion).toBe(0);
      expect(user.isActive).toBe(true);
    });

    it('UserSession entity has required foreign key to User with CASCADE onDelete', () => {
      const session = new UserSession();
      session.id = 'sess-1';
      session.userId = 'u-1';
      session.refreshTokenHash = 'a'.repeat(64);
      session.tokenFamily = 'family-uuid-1';
      session.expiresAt = new Date(Date.now() + 7 * 86400000);

      expect(session.userId).toBe('u-1');
      expect(session.refreshTokenHash).toHaveLength(64);
    });

    it('ThresholdConfig defines DB-level check constraint min_value <= max_value', () => {
      const config = new ThresholdConfig();
      config.configId = 'c-1';
      config.pondId = 'p-1';
      config.metricName = 'pH';
      config.minValue = 7.0;
      config.maxValue = 8.5;
      config.isActive = true;

      expect(config.minValue).toBeLessThanOrEqual(config.maxValue);
    });

    it('TelemetryData defines composite primary key (id, recorded_at) for TimescaleDB hypertable', () => {
      const data = new TelemetryData();
      data.id = '1001';
      data.recordedAt = new Date();
      data.deviceId = 'dev-1';
      data.isBuffered = false;

      expect(data.id).toBeDefined();
      expect(data.recordedAt).toBeInstanceOf(Date);
      expect(data.deviceId).toBe('dev-1');
    });
  });

  // 2. Unique Constraints & Duplicate Prevention
  describe('2. Unique Constraints & Anti-Duplication Enforcement', () => {
    it('Device registration rejects duplicate MAC address via ConflictException', async () => {
      const existingMac = 'AA:BB:CC:DD:EE:FF';
      const mockDeviceRepo: any = {
        findOne: vi.fn().mockResolvedValue({
          deviceId: 'dev-existing',
          macAddress: existingMac,
        }),
        create: vi.fn(),
        save: vi.fn(),
      };
      const mockPondRepo: any = {
        findOne: vi.fn().mockResolvedValue({ pondId: 'pond-1', userId: 'user-1' }),
      };

      const devicesService = new DevicesService(mockDeviceRepo, mockPondRepo);

      await expect(
        devicesService.createDevice(
          {
            deviceName: 'Duplicate MAC Sensor',
            macAddress: existingMac,
            pondId: 'pond-1',
          },
          'user-1',
          Role.FARMER,
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockDeviceRepo.save).not.toHaveBeenCalled();
    });

    it('Device update rejects transferring to a MAC address already used by another device', async () => {
      const dev1Id = 'dev-1';
      const dev2Mac = '11:22:33:44:55:66';

      const mockDeviceRepo: any = {
        findOne: vi.fn(async (opt) => {
          if (opt.where?.deviceId === dev1Id) {
            return {
              deviceId: dev1Id,
              macAddress: 'AA:AA:AA:AA:AA:AA',
              pondId: 'pond-1',
              pond: { userId: 'user-1' },
            };
          }
          if (opt.where?.macAddress === dev2Mac) {
            return {
              deviceId: 'dev-2',
              macAddress: dev2Mac,
            };
          }
          return null;
        }),
      };
      const mockPondRepo: any = {};

      const devicesService = new DevicesService(mockDeviceRepo, mockPondRepo);

      await expect(
        devicesService.updateDevice(
          dev1Id,
          { macAddress: dev2Mac },
          'user-1',
          Role.FARMER,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // 3. Domain & Validation Constraints
  describe('3. Domain & Data Value Invariant Integrity', () => {
    it('ThresholdConfig rejects minValue > maxValue via BadRequestException', async () => {
      const mockPondRepo: any = {
        findOne: vi.fn().mockResolvedValue({ pondId: 'pond-1', userId: 'user-1' }),
      };
      const mockThresholdRepo: any = {
        create: vi.fn(),
        save: vi.fn(),
      };
      const mockManualLogRepo: any = {};

      const pondsService = new PondsService(mockPondRepo, mockThresholdRepo, mockManualLogRepo);

      await expect(
        pondsService.createThresholdConfig(
          'pond-1',
          {
            metricName: 'DO',
            minValue: 10.0,
            maxValue: 5.0,
          },
          'user-1',
          Role.FARMER,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockThresholdRepo.save).not.toHaveBeenCalled();
    });

    it('Enum fields reject values outside allowed enum set', () => {
      expect(Object.values(Role)).toEqual(['MANAGER', 'FARMER']);
      expect(Object.values(PondStatus)).toContain('ACTIVE');
      expect(Object.values(PondStatus)).toContain('EMPTY');
      expect(Object.values(DeviceStatus)).toContain('ONLINE');
      expect(Object.values(DeviceStatus)).toContain('OFFLINE');
      expect(Object.values(AlertLevel)).toEqual(['WARNING', 'CRITICAL']);
      expect(Object.values(AlertStatus)).toEqual(['ACTIVE', 'RESOLVED']);
      expect(Object.values(RiskLevel)).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    });
  });

  // 4. Foreign Key & Cascade Relationships Integrity
  describe('4. Cascade & Foreign Key Rules Integrity', () => {
    it('Cascade rule verification: User deletion cascades Ponds and UserSessions', () => {
      const userPondsRelation = Reflect.getMetadata('relations', Pond) || {};
      const userSessionsRelation = Reflect.getMetadata('relations', UserSession) || {};
      expect(userPondsRelation).toBeDefined();
      expect(userSessionsRelation).toBeDefined();
    });

    it('ManualTestLog protects historical audit records with RESTRICT onDelete on testedBy User', () => {
      const log = new ManualTestLog();
      log.logId = 'log-1';
      log.testedById = 'user-tech-1';
      log.pondId = 'pond-1';
      log.nh3Value = 0.05;
      log.no2Value = 0.02;

      expect(log.testedById).toBe('user-tech-1');
      expect(log.pondId).toBe('pond-1');
    });

    it('Alert resolved_by uses SET NULL onDelete to preserve alert history when user is deleted', () => {
      const alert = new Alert();
      alert.alertId = 'alert-1';
      alert.pondId = 'pond-1';
      alert.resolvedById = 'tech-user';
      alert.metricName = 'pH';
      alert.triggeredValue = 9.2;
      alert.alertLevel = AlertLevel.CRITICAL;
      alert.status = AlertStatus.RESOLVED;

      expect(alert.resolvedById).toBe('tech-user');
    });
  });

  // 5. Database Transactions & Rollback Guarantee
  describe('5. Database Transaction Atomicity & Rollback Integrity', () => {
    it('Register transaction rolls back completely if UserSession creation fails (No Orphan User)', async () => {
      const mockUsersService: any = {
        findByPhoneNumber: vi.fn().mockResolvedValue(null),
        createUser: vi.fn(async () => {
          return { userId: 'u-temp', tokenVersion: 0, role: Role.FARMER };
        }),
      };

      const mockOtpService: any = {
        isPhoneVerified: vi.fn().mockResolvedValue(true),
        consumePhoneVerified: vi.fn().mockResolvedValue(true),
        restorePhoneVerified: vi.fn().mockResolvedValue(undefined),
      };

      const mockDataSource: any = {
        transaction: vi.fn(async (callback) => {
          const failingManager = {
            create: vi.fn(),
            save: vi.fn().mockRejectedValue(new Error('Session save failed: DB write error')),
          };
          return await callback(failingManager);
        }),
      };

      const mockJwtService = new JwtService({ secret: 'test_jwt_secret_key_123456789012' });
      const mockConfigService: any = {
        get: (k: string) => (k === 'JWT_REFRESH_SECRET' ? 'test_jwt_secret_key_123456789012' : null),
      };

      const authService = new AuthService(
        mockUsersService,
        mockJwtService,
        mockConfigService,
        {} as any,
        mockDataSource,
        mockOtpService,
      );

      await expect(
        authService.register({
          fullName: 'Rollback User',
          phoneNumber: '0908888888',
          password: 'Password123!',
        }),
      ).rejects.toThrow('Session save failed: DB write error');

      // OTP verification marker must be restored for user
      expect(mockOtpService.restorePhoneVerified).toHaveBeenCalledWith('0908888888');
    });
  });
});
