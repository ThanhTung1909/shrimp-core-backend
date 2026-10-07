import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginSecurityService } from '../src/common/redis/login-security.service.js';
import { RedisService } from '../src/common/redis/redis.service.js';

describe('LoginSecurityService failure counter TTL', () => {
  const client = {
    incr: vi.fn(),
    expire: vi.fn(),
  };

  const redisService = {
    getClient: vi.fn(() => client),
  } as unknown as RedisService;

  let service: LoginSecurityService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LoginSecurityService(redisService);
  });

  it('sets a 24-hour TTL when the failure counter is created', async () => {
    client.incr.mockResolvedValue(1);
    client.expire.mockResolvedValue(1);

    await expect(service.recordFailure('u1')).resolves.toBe(1);

    expect(client.incr).toHaveBeenCalledWith('auth:login-fail:u1');
    expect(client.expire).toHaveBeenCalledWith(
      'auth:login-fail:u1',
      24 * 60 * 60,
    );
  });

  it('does not refresh the TTL on later failed attempts', async () => {
    client.incr.mockResolvedValue(5);

    await expect(service.recordFailure('u1')).resolves.toBe(5);

    expect(client.incr).toHaveBeenCalledWith('auth:login-fail:u1');
    expect(client.expire).not.toHaveBeenCalled();
  });
});
