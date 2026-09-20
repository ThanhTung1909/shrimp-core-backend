import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { UsersController } from '../src/modules/users/users.controller.js';
import { Role } from '../src/common/enums/role.enum.js';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

describe('SECURITY AUDIT VERIFICATION SUITE', () => {
  const mockAccessSecret = 'test_access_secret_key_minimum_32_bytes_long_12345';
  const mockRefreshSecret = 'test_refresh_secret_key_minimum_32_bytes_long_67890';

  let configService: any;
  let usersService: any;
  let jwtService: JwtService;
  let jwtStrategy: JwtStrategy;
  let authService: AuthService;
  let authController: AuthController;
  let userSessionRepository: any;
  let dataSource: any;
  let sessionsStore: any[] = [];

  beforeEach(() => {
    sessionsStore = [];

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'JWT_ACCESS_SECRET') return mockAccessSecret;
        if (key === 'JWT_REFRESH_SECRET') return mockRefreshSecret;
        if (key === 'JWT_ACCESS_EXPIRES_IN') return '15m';
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
        return null;
      }),
    };

    usersService = {
      findById: vi.fn(),
      findByPhoneNumber: vi.fn(),
      createUser: vi.fn(),
      incrementTokenVersion: vi.fn(),
      updatePassword: vi.fn(),
      sanitizeUser: vi.fn((u) => {
        const { passwordHash, ...safe } = u;
        return safe;
      }),
    };

    userSessionRepository = {
      create: vi.fn((dto) => ({
        ...dto,
        id: 'sess-' + Math.random(),
        revokedAt: null,
        revokeReason: null,
      })),
      save: vi.fn(async (session) => {
        const index = sessionsStore.findIndex((s) => s.id === session.id);
        if (index >= 0) {
          sessionsStore[index] = { ...sessionsStore[index], ...session };
          return sessionsStore[index];
        } else {
          sessionsStore.push(session);
          return session;
        }
      }),
      findOne: vi.fn(async (options) => {
        const hash = options?.where?.refreshTokenHash;
        return sessionsStore.find((s) => s.refreshTokenHash === hash) || null;
      }),
      find: vi.fn(async () => sessionsStore),
    };

    let txQueue = Promise.resolve();
    dataSource = {
      transaction: vi.fn(async (callback) => {
        const runTx = async () => {
          const manager = {
            findOne: vi.fn(async (entity, options) => {
              const hash = options?.where?.refreshTokenHash;
              return sessionsStore.find((s) => s.refreshTokenHash === hash) || null;
            }),
            create: vi.fn((entity, dto) => ({
              ...dto,
              id: 'sess-' + Math.random(),
              revokedAt: null,
              revokeReason: null,
            })),
            save: vi.fn(async (entity, session) => {
              const index = sessionsStore.findIndex((s) => s.id === session.id);
              if (index >= 0) {
                sessionsStore[index] = { ...sessionsStore[index], ...session };
                return sessionsStore[index];
              } else {
                sessionsStore.push(session);
                return session;
              }
            }),
            update: vi.fn(async (entity, criteria, updateData) => {
              let affected = 0;
              for (const s of sessionsStore) {
                let match = true;
                if (criteria.tokenFamily && s.tokenFamily !== criteria.tokenFamily) {
                  match = false;
                }
                if (criteria.userId && s.userId !== criteria.userId) {
                  match = false;
                }
                if ('revokedAt' in criteria) {
                  if (s.revokedAt !== null) {
                    match = false;
                  }
                }
                if (match) {
                  Object.assign(s, updateData);
                  affected++;
                }
              }
              return { affected, raw: [], generatedMaps: [] };
            }),
          };
          return await callback(manager);
        };

        const currentPromise = txQueue.then(runTx, runTx);
        txQueue = currentPromise.then(() => {}, () => {});
        return await currentPromise;
      }),
    };

    jwtService = new JwtService({ secret: mockAccessSecret });
    const originalSignAsync = jwtService.signAsync.bind(jwtService);
    let signCounter = 0;
    vi.spyOn(jwtService, 'signAsync').mockImplementation(async (payload: any, options?: any) => {
      signCounter++;
      return originalSignAsync(payload, {
        ...options,
        jwtid: 'tok-' + signCounter + '-' + Math.random(),
      });
    });

    jwtStrategy = new JwtStrategy(configService, usersService);
    authService = new AuthService(
      usersService,
      jwtService,
      configService,
      userSessionRepository,
      dataSource,
    );
    authController = new AuthController(authService, usersService);
  });

  describe('1. Access Token Security', () => {
    it('Valid Access Token payload -> allowed', async () => {
      const mockUser = {
        userId: 'user-1',
        isActive: true,
        tokenVersion: 1,
        role: Role.FARMER,
      };
      usersService.findById.mockResolvedValue(mockUser);

      const result = await jwtStrategy.validate({
        sub: 'user-1',
        tokenVersion: 1,
        role: 'FARMER',
        type: 'access',
      });

      expect(result).toEqual(mockUser);
    });

    it('Expired or Invalid signature Access Token -> rejected by jwtService verify', async () => {
      const expiredToken = jwtService.sign(
        { sub: 'user-1', tokenVersion: 1, type: 'access' },
        { secret: mockAccessSecret, expiresIn: '-1s' },
      );

      await expect(
        jwtService.verifyAsync(expiredToken, { secret: mockAccessSecret }),
      ).rejects.toThrow();
    });

    it('Wrong secret -> rejected by jwtService verify', async () => {
      const tokenWithWrongSecret = jwtService.sign(
        { sub: 'user-1', tokenVersion: 1, type: 'access' },
        { secret: 'wrong_secret_key_12345678901234567890' },
      );

      await expect(
        jwtService.verifyAsync(tokenWithWrongSecret, { secret: mockAccessSecret }),
      ).rejects.toThrow();
    });

    it('Refresh Token used as Access Token -> 401 Unauthorized', async () => {
      await expect(
        jwtStrategy.validate({
          sub: 'user-1',
          tokenVersion: 1,
          role: 'FARMER',
          type: 'refresh',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('tokenVersion mismatch -> 401 Unauthorized', async () => {
      usersService.findById.mockResolvedValue({
        userId: 'user-1',
        isActive: true,
        tokenVersion: 2, // DB is 2
        role: Role.FARMER,
      });

      await expect(
        jwtStrategy.validate({
          sub: 'user-1',
          tokenVersion: 1, // JWT has old version 1
          role: 'FARMER',
          type: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Inactive user -> 401 Unauthorized', async () => {
      usersService.findById.mockResolvedValue({
        userId: 'user-1',
        isActive: false, // Inactive
        tokenVersion: 1,
        role: Role.FARMER,
      });

      await expect(
        jwtStrategy.validate({
          sub: 'user-1',
          tokenVersion: 1,
          role: 'FARMER',
          type: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('2. Refresh Token Security', () => {
    it('Valid Refresh Token -> issues new token pair (Rotation)', async () => {
      const mockUser = {
        userId: 'user-1',
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
      };
      usersService.findById.mockResolvedValue(mockUser);

      const validRefreshToken = jwtService.sign(
        { sub: 'user-1', tokenVersion: 0, role: 'FARMER', type: 'refresh' },
        { secret: mockRefreshSecret, expiresIn: '7d' },
      );

      // Lưu session tương ứng cho token hợp lệ
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(validRefreshToken).digest('hex');
      sessionsStore.push({
        id: 'session-valid-1',
        userId: 'user-1',
        refreshTokenHash: hash,
        tokenFamily: 'family-1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        revokeReason: null,
      });

      const result = await authService.refreshToken(validRefreshToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');

      // Verify access token uses Access Secret
      const decodedAccess = jwtService.verify(result.accessToken, {
        secret: mockAccessSecret,
      });
      expect(decodedAccess.type).toBe('access');

      // Verify refresh token uses Refresh Secret
      const decodedRefresh = jwtService.verify(result.refreshToken, {
        secret: mockRefreshSecret,
      });
      expect(decodedRefresh.type).toBe('refresh');
    });

    it('Access Token used at refresh endpoint -> rejected', async () => {
      const accessToken = jwtService.sign(
        { sub: 'user-1', tokenVersion: 0, role: 'FARMER', type: 'access' },
        { secret: mockAccessSecret, expiresIn: '15m' },
      );

      await expect(authService.refreshToken(accessToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('Expired Refresh Token -> rejected', async () => {
      const expiredRefreshToken = jwtService.sign(
        { sub: 'user-1', tokenVersion: 0, role: 'FARMER', type: 'refresh' },
        { secret: mockRefreshSecret, expiresIn: '-1s' },
      );

      await expect(authService.refreshToken(expiredRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('Invalid signature / Wrong secret -> rejected', async () => {
      const wrongSecretToken = jwtService.sign(
        { sub: 'user-1', tokenVersion: 0, role: 'FARMER', type: 'refresh' },
        { secret: 'wrong_secret', expiresIn: '7d' },
      );

      await expect(authService.refreshToken(wrongSecretToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('type != refresh -> rejected', async () => {
      const fakeToken = jwtService.sign(
        { sub: 'user-1', tokenVersion: 0, role: 'FARMER', type: 'something_else' },
        { secret: mockRefreshSecret, expiresIn: '7d' },
      );

      await expect(authService.refreshToken(fakeToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('tokenVersion mismatch -> rejected', async () => {
      usersService.findById.mockResolvedValue({
        userId: 'user-1',
        isActive: true,
        tokenVersion: 3, // DB is 3
        role: Role.FARMER,
      });

      const oldRefreshToken = jwtService.sign(
        { sub: 'user-1', tokenVersion: 1, role: 'FARMER', type: 'refresh' },
        { secret: mockRefreshSecret, expiresIn: '7d' },
      );

      await expect(authService.refreshToken(oldRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('Inactive user -> rejected', async () => {
      usersService.findById.mockResolvedValue({
        userId: 'user-1',
        isActive: false, // Locked
        tokenVersion: 1,
        role: Role.FARMER,
      });

      const refreshToken = jwtService.sign(
        { sub: 'user-1', tokenVersion: 1, role: 'FARMER', type: 'refresh' },
        { secret: mockRefreshSecret, expiresIn: '7d' },
      );

      await expect(authService.refreshToken(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('3. RBAC Security', () => {
    let rolesGuard: RolesGuard;
    let reflector: Reflector;

    beforeEach(() => {
      reflector = new Reflector();
      rolesGuard = new RolesGuard(reflector);
    });

    it('MANAGER accessing MANAGER endpoint -> allowed (true)', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.MANAGER]);

      const mockContext: any = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            user: { role: Role.MANAGER },
          }),
        }),
      };

      expect(rolesGuard.canActivate(mockContext)).toBe(true);
    });

    it('FARMER accessing MANAGER endpoint -> 403 Forbidden', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.MANAGER]);

      const mockContext: any = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            user: { role: Role.FARMER },
          }),
        }),
      };

      expect(() => rolesGuard.canActivate(mockContext)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('4. Token Revocation Flow (Logout / Change Password)', () => {
    it('Login -> Logout increments tokenVersion -> Old tokens invalidated', async () => {
      let currentVersion = 0;
      const user = {
        userId: 'user-1',
        phoneNumber: '0901234567',
        passwordHash: '',
        isActive: true,
        get tokenVersion() {
          return currentVersion;
        },
        role: Role.FARMER,
      };

      usersService.findByPhoneNumber.mockResolvedValue(user);
      usersService.findById.mockImplementation(async () => user);
      usersService.incrementTokenVersion.mockImplementation(async () => {
        currentVersion++;
      });

      // 1. User holds tokens with tokenVersion = 0
      const oldAccessPayload = {
        sub: user.userId,
        tokenVersion: 0,
        role: user.role,
        type: 'access',
      };
      const oldRefreshToken = jwtService.sign(
        { sub: user.userId, tokenVersion: 0, role: user.role, type: 'refresh' },
        { secret: mockRefreshSecret, expiresIn: '7d' },
      );

      // Verify token valid before logout
      const validatedBefore = await jwtStrategy.validate(oldAccessPayload);
      expect(validatedBefore.userId).toBe('user-1');

      // 2. User logs out -> tokenVersion increments to 1
      await usersService.incrementTokenVersion('user-1');
      expect(currentVersion).toBe(1);

      // 3. Old Access Token now rejected (401)
      await expect(jwtStrategy.validate(oldAccessPayload)).rejects.toThrow(
        UnauthorizedException,
      );

      // 4. Old Refresh Token now rejected (401)
      await expect(authService.refreshToken(oldRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('5. SEC-001: Privilege Escalation Fix', () => {
    it('Register always forces role to Role.FARMER', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);
      usersService.createUser.mockImplementation(async (data: any) => ({
        userId: 'new-user-id',
        tokenVersion: 0,
        ...data,
      }));

      const res = await authService.register({
        fullName: 'Test User',
        phoneNumber: '0909999999',
        password: 'password123',
      });

      expect(res.role).toBe(Role.FARMER);
      expect(usersService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          role: Role.FARMER,
        }),
        expect.anything(),
      );
    });
  });

  describe('6. SEC-002: BOLA / IDOR Fix in UsersController.getUserById', () => {
    let usersController: UsersController;

    beforeEach(() => {
      usersController = new UsersController(usersService);
    });

    it('FARMER trying to view another user profile -> 403 Forbidden', async () => {
      await expect(
        usersController.getUserById('victim-id', 'attacker-id', Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('FARMER viewing own profile -> allowed', async () => {
      usersService.findById.mockResolvedValue({
        userId: 'my-id',
        fullName: 'Me',
      });

      const result = await usersController.getUserById(
        'my-id',
        'my-id',
        Role.FARMER,
      );
      expect(result).toHaveProperty('userId', 'my-id');
    });

    it('MANAGER viewing any profile -> allowed', async () => {
      usersService.findById.mockResolvedValue({
        userId: 'any-id',
        fullName: 'Any User',
      });

      const result = await usersController.getUserById(
        'any-id',
        'manager-id',
        Role.MANAGER,
      );
      expect(result).toHaveProperty('userId', 'any-id');
    });
  });

  describe('7. Phase 3: Login Creates Server-Side Session', () => {
    it('Login creates UserSession with SHA-256 hash, UUID tokenFamily, and matching expiration', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('valid_password', 10);

      const mockUser = {
        userId: 'user-phase3-id',
        phoneNumber: '0987654321',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 3 User',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);

      const response = await authService.login(
        { phoneNumber: '0987654321', password: 'valid_password' },
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      );

      // 1. Response contract maintained
      expect(response).toEqual({
        userId: mockUser.userId,
        fullName: mockUser.fullName,
        phoneNumber: mockUser.phoneNumber,
        role: mockUser.role,
        tokenVersion: mockUser.tokenVersion,
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });

      // 2. UserSession record created
      expect(userSessionRepository.create).toHaveBeenCalledTimes(1);
      expect(userSessionRepository.save).toHaveBeenCalledTimes(1);

      const createdSession = userSessionRepository.create.mock.calls[0][0];

      expect(createdSession.userId).toBe(mockUser.userId);
      expect(createdSession.deviceName).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      expect(createdSession.refreshTokenHash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(createdSession.refreshTokenHash)).toBe(true);

      // tokenFamily is valid UUID
      expect(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          createdSession.tokenFamily,
        ),
      ).toBe(true);

      // Plaintext check: refreshToken !== refreshTokenHash
      expect(response.refreshToken).not.toBe(createdSession.refreshTokenHash);

      // SHA-256 integrity: hash(response.refreshToken) === createdSession.refreshTokenHash
      const crypto = await import('crypto');
      const computedHash = crypto
        .createHash('sha256')
        .update(response.refreshToken)
        .digest('hex');
      expect(computedHash).toBe(createdSession.refreshTokenHash);

      // Expiration check: matches decoded JWT exp
      const decoded = jwtService.decode(response.refreshToken) as { exp: number };
      expect(createdSession.expiresAt).toEqual(new Date(decoded.exp * 1000));
    });

    it('Multiple logins generate unique tokenFamily and unique refreshTokenHash', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);

      const mockUser = {
        userId: 'user-multilogin',
        phoneNumber: '0912345678',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Multi User',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);

      // Login 1
      await authService.login({ phoneNumber: '0912345678', password: 'pw' }, 'Device 1');
      const session1 = userSessionRepository.create.mock.calls[0][0];

      // Chờ 1 giây để iat (UNIX timestamp theo giây) của JWT tăng lên
      await new Promise((resolve) => setTimeout(resolve, 1050));

      // Login 2
      await authService.login({ phoneNumber: '0912345678', password: 'pw' }, 'Device 2');
      const session2 = userSessionRepository.create.mock.calls[1][0];

      expect(session1.tokenFamily).not.toBe(session2.tokenFamily);
      expect(session1.refreshTokenHash).not.toBe(session2.refreshTokenHash);
      expect(session1.userId).toBe(session2.userId);
    });

    it('If session save fails, login throws error and does not return tokens', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);

      const mockUser = {
        userId: 'user-fail',
        phoneNumber: '0911111111',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Fail User',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      userSessionRepository.save.mockRejectedValueOnce(new Error('Database error'));

      await expect(
        authService.login({ phoneNumber: '0911111111', password: 'pw' }),
      ).rejects.toThrow('Database error');
    });
  });

  describe('8. Phase 4: Refresh Token Rotation', () => {
    it('TEST 1 to 4: Refresh success -> new tokens issued, old session revoked with ROTATED, tokenFamily preserved', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-rot-1',
        phoneNumber: '0933333333',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Rot User',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // 1. User logins
      const loginRes = await authService.login(
        { phoneNumber: '0933333333', password: 'pw' },
        'Device Chrome',
      );
      const oldRefreshToken = loginRes.refreshToken;

      const crypto = await import('crypto');
      const oldHash = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');
      const oldSessionBefore = sessionsStore.find((s) => s.refreshTokenHash === oldHash);
      expect(oldSessionBefore).toBeDefined();
      expect(oldSessionBefore.revokedAt).toBeNull();
      const initialFamily = oldSessionBefore.tokenFamily;

      // 2. User refreshes
      const refreshRes = await authService.refreshToken(oldRefreshToken);

      // TEST 1: New tokens issued and different from old
      expect(refreshRes).toHaveProperty('accessToken');
      expect(refreshRes).toHaveProperty('refreshToken');
      expect(refreshRes.refreshToken).not.toBe(oldRefreshToken);

      // TEST 2: Old session revoked with 'ROTATED'
      const oldSessionAfter = sessionsStore.find((s) => s.refreshTokenHash === oldHash);
      expect(oldSessionAfter.revokedAt).toBeInstanceOf(Date);
      expect(oldSessionAfter.revokeReason).toBe('ROTATED');

      // TEST 3: New session active
      const newHash = crypto.createHash('sha256').update(refreshRes.refreshToken).digest('hex');
      const newSession = sessionsStore.find((s) => s.refreshTokenHash === newHash);
      expect(newSession).toBeDefined();
      expect(newSession.revokedAt).toBeNull();
      expect(newSession.revokeReason).toBeNull();

      // TEST 4: Token family preserved
      expect(newSession.tokenFamily).toBe(initialFamily);

      // TEST 8: Expiration matches decoded JWT exp
      const decodedNew = jwtService.decode(refreshRes.refreshToken) as { exp: number };
      expect(newSession.expiresAt).toEqual(new Date(decodedNew.exp * 1000));
    });

    it('TEST 5: Old token rejected after rotation', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-rot-2',
        phoneNumber: '0944444444',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Rot User 2',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login and then rotate
      const loginRes = await authService.login({ phoneNumber: '0944444444', password: 'pw' });
      const oldToken = loginRes.refreshToken;
      await authService.refreshToken(oldToken);

      // Attempting to reuse oldToken must be rejected
      await expect(authService.refreshToken(oldToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('TEST 6: New token works for subsequent refresh', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-rot-3',
        phoneNumber: '0955555555',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Rot User 3',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      const loginRes = await authService.login({ phoneNumber: '0955555555', password: 'pw' });
      const rot1 = await authService.refreshToken(loginRes.refreshToken);

      // Subsequent refresh with new token succeeds
      const rot2 = await authService.refreshToken(rot1.refreshToken);
      expect(rot2).toHaveProperty('accessToken');
      expect(rot2).toHaveProperty('refreshToken');
      expect(rot2.refreshToken).not.toBe(rot1.refreshToken);
    });

    it('TEST 7: Multiple rotations (A -> B -> C) preserve same tokenFamily', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-rot-4',
        phoneNumber: '0966666666',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Rot User 4',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      const crypto = await import('crypto');

      // 1. Login (Token A)
      const loginRes = await authService.login({ phoneNumber: '0966666666', password: 'pw' });
      const hashA = crypto.createHash('sha256').update(loginRes.refreshToken).digest('hex');

      // 2. Refresh 1 (Token B)
      const resB = await authService.refreshToken(loginRes.refreshToken);
      const hashB = crypto.createHash('sha256').update(resB.refreshToken).digest('hex');

      // 3. Refresh 2 (Token C)
      const resC = await authService.refreshToken(resB.refreshToken);
      const hashC = crypto.createHash('sha256').update(resC.refreshToken).digest('hex');

      const sessA = sessionsStore.find((s) => s.refreshTokenHash === hashA);
      const sessB = sessionsStore.find((s) => s.refreshTokenHash === hashB);
      const sessC = sessionsStore.find((s) => s.refreshTokenHash === hashC);

      expect(sessA.revokedAt).toBeInstanceOf(Date);
      expect(sessA.revokeReason).toBe('ROTATED');

      expect(sessB.revokedAt).toBeInstanceOf(Date);
      expect(sessB.revokeReason).toBe('ROTATED');

      expect(sessC.revokedAt).toBeNull();
      expect(sessC.revokeReason).toBeNull();

      expect(sessA.tokenFamily).toBe(sessB.tokenFamily);
      expect(sessB.tokenFamily).toBe(sessC.tokenFamily);
    });

    it('TEST 9: Non-existent or invalid session rejected', async () => {
      const validJwtFormatWithoutSession = jwtService.sign(
        { sub: 'user-1', tokenVersion: 0, role: 'FARMER', type: 'refresh' },
        { secret: mockRefreshSecret, expiresIn: '7d' },
      );
      usersService.findById.mockResolvedValue({ userId: 'user-1', isActive: true, tokenVersion: 0 });

      await expect(
        authService.refreshToken(validJwtFormatWithoutSession),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('TEST 10: Inactive user rejected during refresh', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-rot-inactive',
        phoneNumber: '0977777777',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Inactive User',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      const loginRes = await authService.login({ phoneNumber: '0977777777', password: 'pw' });

      // Deactivate user before refresh
      usersService.findById.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(
        authService.refreshToken(loginRes.refreshToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('TEST 11: Concurrent refresh -> only one rotation succeeds, duplicate is rejected', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-rot-concurrent',
        phoneNumber: '0988888888',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Concurrent User',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      const loginRes = await authService.login({ phoneNumber: '0988888888', password: 'pw' });
      const token = loginRes.refreshToken;

      // Simulate 2 concurrent requests
      const results = await Promise.allSettled([
        authService.refreshToken(token),
        authService.refreshToken(token),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });

  describe('PHASE 5: REFRESH TOKEN REUSE DETECTION & FAMILY REVOCATION', () => {
    it('TEST 1: Normal rotation marks old session ROTATED and keeps same tokenFamily', async () => {
      const bcrypt = await import('bcrypt');
      const crypto = await import('crypto');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p5-1',
        phoneNumber: '0911111111',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 5 User 1',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login -> R1
      const loginRes = await authService.login({ phoneNumber: '0911111111', password: 'pw' });
      const r1 = loginRes.refreshToken;
      const r1Hash = crypto.createHash('sha256').update(r1).digest('hex');

      // Refresh R1 -> R2
      const refreshRes = await authService.refreshToken(r1);
      const r2 = refreshRes.refreshToken;
      const r2Hash = crypto.createHash('sha256').update(r2).digest('hex');

      const s1 = sessionsStore.find((s) => s.refreshTokenHash === r1Hash);
      const s2 = sessionsStore.find((s) => s.refreshTokenHash === r2Hash);

      expect(s1.revokedAt).toBeInstanceOf(Date);
      expect(s1.revokeReason).toBe('ROTATED');

      expect(s2.revokedAt).toBeNull();
      expect(s2.revokeReason).toBeNull();

      expect(s1.tokenFamily).toBe(s2.tokenFamily);
    });

    it('TEST 2: Reuse old refresh token returns 401 Unauthorized and does not create new tokens', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p5-2',
        phoneNumber: '0922222222',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 5 User 2',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login -> R1
      const loginRes = await authService.login({ phoneNumber: '0922222222', password: 'pw' });
      const r1 = loginRes.refreshToken;

      // Refresh R1 -> R2
      await authService.refreshToken(r1);

      // Replay R1 (Reuse old token) -> Expect 401
      await expect(authService.refreshToken(r1)).rejects.toThrow(UnauthorizedException);
    });

    it('TEST 3: Reuse revokes current active token with REUSE_DETECTED and preserves ROTATED on old token', async () => {
      const bcrypt = await import('bcrypt');
      const crypto = await import('crypto');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p5-3',
        phoneNumber: '0933333333',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 5 User 3',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login -> R1
      const loginRes = await authService.login({ phoneNumber: '0933333333', password: 'pw' });
      const r1 = loginRes.refreshToken;
      const r1Hash = crypto.createHash('sha256').update(r1).digest('hex');

      // Refresh R1 -> R2 (R1 becomes ROTATED, R2 is ACTIVE)
      const refreshRes = await authService.refreshToken(r1);
      const r2 = refreshRes.refreshToken;
      const r2Hash = crypto.createHash('sha256').update(r2).digest('hex');

      // Attacker replays R1
      await expect(authService.refreshToken(r1)).rejects.toThrow(UnauthorizedException);

      const s1 = sessionsStore.find((s) => s.refreshTokenHash === r1Hash);
      const s2 = sessionsStore.find((s) => s.refreshTokenHash === r2Hash);

      // R1 must keep ROTATED (history preserved)
      expect(s1.revokedAt).toBeInstanceOf(Date);
      expect(s1.revokeReason).toBe('ROTATED');

      // R2 was active, now must be revoked with REUSE_DETECTED
      expect(s2.revokedAt).toBeInstanceOf(Date);
      expect(s2.revokeReason).toBe('REUSE_DETECTED');
    });

    it('TEST 4: Reuse only revokes compromised family, other device/family remains active', async () => {
      const bcrypt = await import('bcrypt');
      const crypto = await import('crypto');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p5-4',
        phoneNumber: '0944444444',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 5 User 4',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Device A Login -> Family A -> R1
      const loginDevA = await authService.login(
        { phoneNumber: '0944444444', password: 'pw' },
        'Device A',
      );
      const r1 = loginDevA.refreshToken;
      const r1Hash = crypto.createHash('sha256').update(r1).digest('hex');

      // Device B Login -> Family B -> R3
      const loginDevB = await authService.login(
        { phoneNumber: '0944444444', password: 'pw' },
        'Device B',
      );
      const r3 = loginDevB.refreshToken;
      const r3Hash = crypto.createHash('sha256').update(r3).digest('hex');

      // Rotate R1 -> R2 on Device A
      const rotDevA = await authService.refreshToken(r1);
      const r2 = rotDevA.refreshToken;
      const r2Hash = crypto.createHash('sha256').update(r2).digest('hex');

      const sDevB = sessionsStore.find((s) => s.refreshTokenHash === r3Hash);
      const familyB = sDevB.tokenFamily;

      // Replay R1 (Reuse in Family A)
      await expect(authService.refreshToken(r1)).rejects.toThrow(UnauthorizedException);

      // Check Family A sessions:
      const s1 = sessionsStore.find((s) => s.refreshTokenHash === r1Hash);
      const s2 = sessionsStore.find((s) => s.refreshTokenHash === r2Hash);
      expect(s1.revokeReason).toBe('ROTATED');
      expect(s2.revokeReason).toBe('REUSE_DETECTED');

      // Check Family B session: R3 MUST STILL BE ACTIVE!
      expect(sDevB.revokedAt).toBeNull();
      expect(sDevB.revokeReason).toBeNull();

      // Device B should still be able to refresh R3!
      const rotDevB = await authService.refreshToken(r3);
      expect(rotDevB).toHaveProperty('accessToken');
      expect(rotDevB).toHaveProperty('refreshToken');
    });

    it('TEST 5: Reuse token does not create new session and session count stays constant', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p5-5',
        phoneNumber: '0955555555',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 5 User 5',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login -> R1 (1 session)
      const loginRes = await authService.login({ phoneNumber: '0955555555', password: 'pw' });
      const r1 = loginRes.refreshToken;

      // Rotate R1 -> R2 (2 sessions: R1 rotated, R2 active)
      await authService.refreshToken(r1);
      const countBeforeReuse = sessionsStore.length;
      expect(countBeforeReuse).toBe(2);

      // Reuse R1
      await expect(authService.refreshToken(r1)).rejects.toThrow(UnauthorizedException);

      // Total session count must NOT increase
      expect(sessionsStore.length).toBe(countBeforeReuse);
    });

    it('TEST 6: Concurrent refresh -> one succeeds, duplicate detects reuse and revokes family', async () => {
      const bcrypt = await import('bcrypt');
      const crypto = await import('crypto');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p5-6',
        phoneNumber: '0966666666',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 5 User 6',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      const loginRes = await authService.login({ phoneNumber: '0966666666', password: 'pw' });
      const token = loginRes.refreshToken;

      const results = await Promise.allSettled([
        authService.refreshToken(token),
        authService.refreshToken(token),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Because the second request detected the already-rotated token as reuse,
      // the newly created session from the first request was revoked as REUSE_DETECTED!
      const initialHash = crypto.createHash('sha256').update(token).digest('hex');
      const initialSession = sessionsStore.find((s) => s.refreshTokenHash === initialHash);
      expect(initialSession.revokeReason).toBe('ROTATED');

      const familySessions = sessionsStore.filter((s) => s.tokenFamily === initialSession.tokenFamily);
      const activeInFamily = familySessions.filter((s) => s.revokedAt === null);
      expect(activeInFamily).toHaveLength(0);
    });
  });

  describe('PHASE 6: PER-DEVICE LOGOUT & LOGOUT ALL', () => {
    it('TEST 1: Logout-all increments tokenVersion and revokes all active sessions with LOGOUT_ALL', async () => {
      const bcrypt = await import('bcrypt');
      const crypto = await import('crypto');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p6-1',
        phoneNumber: '0971111111',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 6 User 1',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login Device A -> Family A -> Session A
      const loginA = await authService.login({ phoneNumber: '0971111111', password: 'pw' }, 'Device A');
      const hashA = crypto.createHash('sha256').update(loginA.refreshToken).digest('hex');

      // Login Device B -> Family B -> Session B
      const loginB = await authService.login({ phoneNumber: '0971111111', password: 'pw' }, 'Device B');
      const hashB = crypto.createHash('sha256').update(loginB.refreshToken).digest('hex');

      const sessA = sessionsStore.find((s) => s.refreshTokenHash === hashA);
      const sessB = sessionsStore.find((s) => s.refreshTokenHash === hashB);
      expect(sessA.revokedAt).toBeNull();
      expect(sessB.revokedAt).toBeNull();

      // Call logout-all
      const res = await authController.logoutAll('user-p6-1');
      expect(res).toEqual({ message: 'Đã đăng xuất khỏi tất cả thiết bị!' });

      expect(usersService.incrementTokenVersion).toHaveBeenCalledWith('user-p6-1', expect.anything());
      expect(sessA.revokedAt).toBeInstanceOf(Date);
      expect(sessA.revokeReason).toBe('LOGOUT_ALL');
      expect(sessB.revokedAt).toBeInstanceOf(Date);
      expect(sessB.revokeReason).toBe('LOGOUT_ALL');
    });

    it('TEST 2: Logout-all does not overwrite previously revoked sessions (ROTATED, REUSE_DETECTED)', async () => {
      const bcrypt = await import('bcrypt');
      const crypto = await import('crypto');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p6-2',
        phoneNumber: '0972222222',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 6 User 2',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // 1. Manually add Session A (ROTATED) and Session B (REUSE_DETECTED) and Session C (ACTIVE)
      const sessA = {
        id: 'sess-a',
        userId: 'user-p6-2',
        refreshTokenHash: 'hash-a',
        tokenFamily: 'fam-a',
        deviceName: 'Device A',
        revokedAt: new Date(Date.now() - 10000),
        revokeReason: 'ROTATED',
        expiresAt: new Date(Date.now() + 100000),
      };
      const sessB = {
        id: 'sess-b',
        userId: 'user-p6-2',
        refreshTokenHash: 'hash-b',
        tokenFamily: 'fam-a',
        deviceName: 'Device A',
        revokedAt: new Date(Date.now() - 5000),
        revokeReason: 'REUSE_DETECTED',
        expiresAt: new Date(Date.now() + 100000),
      };
      const sessC = {
        id: 'sess-c',
        userId: 'user-p6-2',
        refreshTokenHash: 'hash-c',
        tokenFamily: 'fam-c',
        deviceName: 'Device C',
        revokedAt: null,
        revokeReason: null,
        expiresAt: new Date(Date.now() + 100000),
      };
      sessionsStore.push(sessA, sessB, sessC);

      // Call logout-all
      await authController.logoutAll('user-p6-2');

      expect(sessA.revokeReason).toBe('ROTATED');
      expect(sessB.revokeReason).toBe('REUSE_DETECTED');
      expect(sessC.revokedAt).toBeInstanceOf(Date);
      expect(sessC.revokeReason).toBe('LOGOUT_ALL');
    });

    it('TEST 3: Logout-all invalidates refresh tokens for all devices', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p6-3',
        phoneNumber: '0973333333',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 6 User 3',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login Device 1 -> R1
      const login1 = await authService.login({ phoneNumber: '0973333333', password: 'pw' });
      const r1 = login1.refreshToken;

      // Login Device 2 -> R2
      const login2 = await authService.login({ phoneNumber: '0973333333', password: 'pw' });
      const r2 = login2.refreshToken;

      // Logout All
      await authController.logoutAll('user-p6-3');

      // When incrementTokenVersion runs, DB user tokenVersion becomes 1
      usersService.findById.mockResolvedValue({
        ...mockUser,
        tokenVersion: 1,
      });

      // Both R1 and R2 must be rejected with 401
      await expect(authService.refreshToken(r1)).rejects.toThrow(UnauthorizedException);
      await expect(authService.refreshToken(r2)).rejects.toThrow(UnauthorizedException);
    });

    it('TEST 4: Per-device logout by refreshToken revokes only current session, leaving other devices active', async () => {
      const bcrypt = await import('bcrypt');
      const crypto = await import('crypto');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p6-4',
        phoneNumber: '0974444444',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 6 User 4',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login Device 1 -> R1
      const login1 = await authService.login({ phoneNumber: '0974444444', password: 'pw' }, 'Device 1');
      const r1 = login1.refreshToken;
      const hash1 = crypto.createHash('sha256').update(r1).digest('hex');

      // Login Device 2 -> R2
      const login2 = await authService.login({ phoneNumber: '0974444444', password: 'pw' }, 'Device 2');
      const r2 = login2.refreshToken;
      const hash2 = crypto.createHash('sha256').update(r2).digest('hex');

      // Logout Device 1 using R1
      const logoutRes = await authController.logout('user-p6-4', { refreshToken: r1 });
      expect(logoutRes).toEqual({ message: 'Đăng xuất thành công!' });

      // Session R1 must be revoked with LOGOUT
      const s1 = sessionsStore.find((s) => s.refreshTokenHash === hash1);
      expect(s1.revokedAt).toBeInstanceOf(Date);
      expect(s1.revokeReason).toBe('LOGOUT');

      // Session R2 must remain active
      const s2 = sessionsStore.find((s) => s.refreshTokenHash === hash2);
      expect(s2.revokedAt).toBeNull();
      expect(s2.revokeReason).toBeNull();

      // Refresh R1 fails with 401
      await expect(authService.refreshToken(r1)).rejects.toThrow(UnauthorizedException);

      // Refresh R2 succeeds
      const refreshRes2 = await authService.refreshToken(r2);
      expect(refreshRes2).toHaveProperty('accessToken');
      expect(refreshRes2).toHaveProperty('refreshToken');
    });

    it('TEST 5: Cannot logout session belonging to another user', async () => {
      const bcrypt = await import('bcrypt');
      const crypto = await import('crypto');
      const passwordHash = await bcrypt.hash('pw', 10);

      const userA = {
        userId: 'user-a',
        phoneNumber: '0975555551',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'User A',
      };
      const userB = {
        userId: 'user-b',
        phoneNumber: '0975555552',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'User B',
      };

      // User A logins -> R1
      usersService.findByPhoneNumber.mockResolvedValue(userA);
      const loginA = await authService.login({ phoneNumber: '0975555551', password: 'pw' });
      const r1 = loginA.refreshToken;
      const hash1 = crypto.createHash('sha256').update(r1).digest('hex');

      // User B attempts to logout using User A's token R1
      const logoutRes = await authController.logout('user-b', { refreshToken: r1 });
      expect(logoutRes).toEqual({ message: 'Đăng xuất thành công!' });

      // User A's session must NOT be revoked!
      const sessA = sessionsStore.find((s) => s.refreshTokenHash === hash1);
      expect(sessA.revokedAt).toBeNull();
      expect(sessA.revokeReason).toBeNull();
    });

    it('TEST 6: Logout does not create new tokens or new sessions', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('pw', 10);
      const mockUser = {
        userId: 'user-p6-6',
        phoneNumber: '0976666666',
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 6 User 6',
      };
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);

      // Login -> 1 session
      const loginRes = await authService.login({ phoneNumber: '0976666666', password: 'pw' });
      const countBefore = sessionsStore.length;

      // Logout single device
      const logoutSingle = await authController.logout('user-p6-6', { refreshToken: loginRes.refreshToken });
      expect(logoutSingle).not.toHaveProperty('accessToken');
      expect(logoutSingle).not.toHaveProperty('refreshToken');
      expect(sessionsStore.length).toBe(countBefore);

      // Logout all
      const logoutAllRes = await authController.logoutAll('user-p6-6');
      expect(logoutAllRes).not.toHaveProperty('accessToken');
      expect(logoutAllRes).not.toHaveProperty('refreshToken');
      expect(sessionsStore.length).toBe(countBefore);
    });
  });

  describe('PHASE 7: CHANGE PASSWORD & REVOKE ALL SESSIONS', () => {
    it('TEST 1: Change password succeeds -> new password verifies, old password fails', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('oldPassword123', 10);
      const mockUser = {
        userId: 'user-p7-1',
        phoneNumber: '0981111111',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 7 User 1',
      };
      usersService.findById.mockResolvedValue(mockUser);
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.updatePassword.mockImplementation(async (_id: string, newHash: string) => {
        mockUser.passwordHash = newHash;
      });

      const res = await authController.changePassword('user-p7-1', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
      });

      expect(res).toEqual({ message: 'Thay đổi mật khẩu thành công!' });
      expect(await bcrypt.compare('newPassword456', mockUser.passwordHash)).toBe(true);
      expect(await bcrypt.compare('oldPassword123', mockUser.passwordHash)).toBe(false);
    });

    it('TEST 2: Wrong current password returns 401 and does not update password or revoke sessions', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('correctPassword123', 10);
      const mockUser = {
        userId: 'user-p7-2',
        phoneNumber: '0982222222',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 7 User 2',
      };
      usersService.findById.mockResolvedValue(mockUser);

      // Create an active session
      const activeSession = {
        id: 'sess-p7-2',
        userId: 'user-p7-2',
        refreshTokenHash: 'hash-p7-2',
        tokenFamily: 'fam-p7-2',
        deviceName: 'Device',
        revokedAt: null,
        revokeReason: null,
        expiresAt: new Date(Date.now() + 100000),
      };
      sessionsStore.push(activeSession);

      await expect(
        authController.changePassword('user-p7-2', {
          currentPassword: 'wrongPassword123',
          newPassword: 'newPassword456',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.updatePassword).not.toHaveBeenCalled();
      expect(usersService.incrementTokenVersion).not.toHaveBeenCalled();
      expect(activeSession.revokedAt).toBeNull();
      expect(activeSession.revokeReason).toBeNull();
    });

    it('TEST 3: Change password revokes all active sessions with PASSWORD_CHANGED', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('oldPassword123', 10);
      const mockUser = {
        userId: 'user-p7-3',
        phoneNumber: '0983333333',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 7 User 3',
      };
      usersService.findById.mockResolvedValue(mockUser);
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);

      const sessA = {
        id: 'sess-p7-3a',
        userId: 'user-p7-3',
        refreshTokenHash: 'hash-3a',
        tokenFamily: 'fam-3a',
        deviceName: 'Device A',
        revokedAt: null,
        revokeReason: null,
        expiresAt: new Date(Date.now() + 100000),
      };
      const sessB = {
        id: 'sess-p7-3b',
        userId: 'user-p7-3',
        refreshTokenHash: 'hash-3b',
        tokenFamily: 'fam-3b',
        deviceName: 'Device B',
        revokedAt: null,
        revokeReason: null,
        expiresAt: new Date(Date.now() + 100000),
      };
      sessionsStore.push(sessA, sessB);

      await authController.changePassword('user-p7-3', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
      });

      expect(sessA.revokedAt).toBeInstanceOf(Date);
      expect(sessA.revokeReason).toBe('PASSWORD_CHANGED');
      expect(sessB.revokedAt).toBeInstanceOf(Date);
      expect(sessB.revokeReason).toBe('PASSWORD_CHANGED');
    });

    it('TEST 4: Change password preserves history of previously revoked sessions (ROTATED, REUSE_DETECTED, LOGOUT)', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('oldPassword123', 10);
      const mockUser = {
        userId: 'user-p7-4',
        phoneNumber: '0984444444',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 7 User 4',
      };
      usersService.findById.mockResolvedValue(mockUser);

      const sessA = {
        id: 'sess-p7-4a',
        userId: 'user-p7-4',
        refreshTokenHash: 'hash-4a',
        tokenFamily: 'fam-4',
        deviceName: 'Device A',
        revokedAt: new Date(Date.now() - 20000),
        revokeReason: 'ROTATED',
        expiresAt: new Date(Date.now() + 100000),
      };
      const sessB = {
        id: 'sess-p7-4b',
        userId: 'user-p7-4',
        refreshTokenHash: 'hash-4b',
        tokenFamily: 'fam-4',
        deviceName: 'Device A',
        revokedAt: new Date(Date.now() - 15000),
        revokeReason: 'REUSE_DETECTED',
        expiresAt: new Date(Date.now() + 100000),
      };
      const sessC = {
        id: 'sess-p7-4c',
        userId: 'user-p7-4',
        refreshTokenHash: 'hash-4c',
        tokenFamily: 'fam-4c',
        deviceName: 'Device C',
        revokedAt: new Date(Date.now() - 10000),
        revokeReason: 'LOGOUT',
        expiresAt: new Date(Date.now() + 100000),
      };
      const sessD = {
        id: 'sess-p7-4d',
        userId: 'user-p7-4',
        refreshTokenHash: 'hash-4d',
        tokenFamily: 'fam-4d',
        deviceName: 'Device D',
        revokedAt: null,
        revokeReason: null,
        expiresAt: new Date(Date.now() + 100000),
      };
      sessionsStore.push(sessA, sessB, sessC, sessD);

      await authController.changePassword('user-p7-4', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
      });

      expect(sessA.revokeReason).toBe('ROTATED');
      expect(sessB.revokeReason).toBe('REUSE_DETECTED');
      expect(sessC.revokeReason).toBe('LOGOUT');
      expect(sessD.revokedAt).toBeInstanceOf(Date);
      expect(sessD.revokeReason).toBe('PASSWORD_CHANGED');
    });

    it('TEST 5: tokenVersion increments exactly once upon successful change password', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('oldPassword123', 10);
      const mockUser = {
        userId: 'user-p7-5',
        phoneNumber: '0985555555',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 3,
        role: Role.FARMER,
        fullName: 'Phase 7 User 5',
      };
      usersService.findById.mockResolvedValue(mockUser);
      usersService.incrementTokenVersion.mockImplementation(async () => {
        mockUser.tokenVersion++;
      });

      await authController.changePassword('user-p7-5', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
      });

      expect(usersService.incrementTokenVersion).toHaveBeenCalledTimes(1);
      expect(mockUser.tokenVersion).toBe(4);
    });

    it('TEST 6: Old refresh token cannot be refreshed after change password', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('oldPassword123', 10);
      const mockUser = {
        userId: 'user-p7-6',
        phoneNumber: '0986666666',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 7 User 6',
      };
      usersService.findById.mockResolvedValue(mockUser);
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.incrementTokenVersion.mockImplementation(async () => {
        mockUser.tokenVersion++;
      });

      // User logins -> gets R1
      const loginRes = await authService.login({ phoneNumber: '0986666666', password: 'oldPassword123' });
      const oldRefreshToken = loginRes.refreshToken;

      // User changes password
      await authController.changePassword('user-p7-6', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
      });

      // Refreshing with oldRefreshToken must fail with 401
      await expect(authService.refreshToken(oldRefreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('TEST 7: Old access token is rejected by JwtStrategy after change password', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('oldPassword123', 10);
      const mockUser = {
        userId: 'user-p7-7',
        phoneNumber: '0987777777',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 7 User 7',
      };
      usersService.findById.mockResolvedValue(mockUser);
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.incrementTokenVersion.mockImplementation(async () => {
        mockUser.tokenVersion++;
      });

      // User logins and gets access token with tokenVersion: 0
      const loginRes = await authService.login({ phoneNumber: '0987777777', password: 'oldPassword123' });
      const oldAccessToken = loginRes.accessToken;
      const decodedPayload = jwtService.decode(oldAccessToken) as any;

      // Before change password, access token is valid
      const validatedBefore = await jwtStrategy.validate(decodedPayload);
      expect(validatedBefore.userId).toBe('user-p7-7');

      // Change password (increments mockUser.tokenVersion to 1)
      await authController.changePassword('user-p7-7', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
      });

      // JwtStrategy.validate with old payload (tokenVersion: 0) must now throw UnauthorizedException
      await expect(jwtStrategy.validate(decodedPayload)).rejects.toThrow(UnauthorizedException);
    });

    it('TEST 8: User can login with new password and old password is rejected', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('oldPassword123', 10);
      const mockUser = {
        userId: 'user-p7-8',
        phoneNumber: '0988888889',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 7 User 8',
      };
      usersService.findById.mockResolvedValue(mockUser);
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);
      usersService.updatePassword.mockImplementation(async (_id: string, newHash: string) => {
        mockUser.passwordHash = newHash;
      });

      // Change password
      await authController.changePassword('user-p7-8', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
      });

      // Login with old password fails
      await expect(
        authService.login({ phoneNumber: '0988888889', password: 'oldPassword123' }),
      ).rejects.toThrow(UnauthorizedException);

      // Login with new password succeeds
      const newLogin = await authService.login({ phoneNumber: '0988888889', password: 'newPassword456' });
      expect(newLogin).toHaveProperty('accessToken');
      expect(newLogin).toHaveProperty('refreshToken');
    });

    it('TEST 9: Change password does not create any new session and session count stays constant', async () => {
      const bcrypt = await import('bcrypt');
      const oldPasswordHash = await bcrypt.hash('oldPassword123', 10);
      const mockUser = {
        userId: 'user-p7-9',
        phoneNumber: '0989999999',
        passwordHash: oldPasswordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Phase 7 User 9',
      };
      usersService.findById.mockResolvedValue(mockUser);
      usersService.findByPhoneNumber.mockResolvedValue(mockUser);

      // Login -> creates 1 session
      await authService.login({ phoneNumber: '0989999999', password: 'oldPassword123' });
      const countBefore = sessionsStore.length;
      expect(countBefore).toBe(1);

      // Change password
      const changeRes = await authController.changePassword('user-p7-9', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
      });

      expect(changeRes).not.toHaveProperty('accessToken');
      expect(changeRes).not.toHaveProperty('refreshToken');
      expect(sessionsStore.length).toBe(countBefore);
      expect(sessionsStore[0].revokeReason).toBe('PASSWORD_CHANGED');
    });
  });
});



