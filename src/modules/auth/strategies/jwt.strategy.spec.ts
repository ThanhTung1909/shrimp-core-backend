import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy.js';
import { sanitizeUser } from '../../../common/utils/sanitize-user.util.js';
import { Role } from '../../../common/enums/role.enum.js';
import { User } from '../../users/entities/user.entity.js';

describe('JwtStrategy', () => {
  it('preserves mustChangePassword and tokenVersion for /auth/me while stripping passwordHash, fcmToken, and isLocked', async () => {
    const configService = {
      get: vi.fn((key: string) =>
        key === 'JWT_ACCESS_SECRET' ? 'test-access-secret' : undefined,
      ),
    } as unknown as ConfigService;

    const user = {
      userId: 'user-1',
      fullName: 'Test User',
      phoneNumber: '0901234567',
      email: 'test@example.com',
      gender: null,
      dateOfBirth: null,
      role: Role.FARMER,
      isActive: true,
      isLocked: false,
      mustChangePassword: true,
      tokenVersion: 4,
      passwordHash: '$2b$10$secret',
      fcmToken: 'fcm-secret',
    } as User;

    const usersService = {
      findById: vi.fn().mockResolvedValue(user),
      sanitizeUser: vi.fn((u: User) => sanitizeUser(u)),
    };

    const redisService = {
      get: vi.fn().mockResolvedValue(null),
    };

    const strategy = new JwtStrategy(
      configService,
      usersService as any,
      redisService as any,
    );

    const validated = await strategy.validate({
      sub: 'user-1',
      tokenVersion: 4,
      role: Role.FARMER,
      type: 'access',
      jti: 'jti-123',
    });

    expect(validated).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        mustChangePassword: true,
        tokenVersion: 4,
      }),
    );
    expect(validated).not.toHaveProperty('passwordHash');
    expect(validated).not.toHaveProperty('fcmToken');
    expect(validated).not.toHaveProperty('isLocked');
  });
});
