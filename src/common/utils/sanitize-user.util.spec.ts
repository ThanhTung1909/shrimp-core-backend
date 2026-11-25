import { describe, expect, it } from 'vitest';
import { sanitizeUser } from './sanitize-user.util.js';

describe('sanitizeUser', () => {
  it('strips passwordHash, fcmToken, tokenVersion, isLocked, and mustChangePassword while preserving safe fields', () => {
    const raw = {
      userId: 'user-1',
      fullName: 'Nguyen Van A',
      phoneNumber: '0901234567',
      email: 'a@example.com',
      role: 'FARMER',
      isActive: true,
      passwordHash: '$2b$10$secret',
      fcmToken: 'fcm-token-xyz',
      tokenVersion: 5,
      isLocked: true,
      mustChangePassword: true,
    };

    const safe = sanitizeUser(raw);

    expect(safe).toEqual({
      userId: 'user-1',
      fullName: 'Nguyen Van A',
      phoneNumber: '0901234567',
      email: 'a@example.com',
      role: 'FARMER',
      isActive: true,
    });
    expect(safe).not.toHaveProperty('passwordHash');
    expect(safe).not.toHaveProperty('fcmToken');
    expect(safe).not.toHaveProperty('tokenVersion');
    expect(safe).not.toHaveProperty('isLocked');
    expect(safe).not.toHaveProperty('mustChangePassword');
  });

  it('does not mutate the original input object', () => {
    const raw = {
      userId: 'user-1',
      passwordHash: 'secret',
      fcmToken: 'fcm',
      tokenVersion: 1,
      isLocked: false,
      mustChangePassword: false,
    };

    sanitizeUser(raw);

    expect(raw.passwordHash).toBe('secret');
    expect(raw.tokenVersion).toBe(1);
  });

  it('returns undefined for null or undefined inputs', () => {
    expect(sanitizeUser(null)).toBeUndefined();
    expect(sanitizeUser(undefined)).toBeUndefined();
  });
});
