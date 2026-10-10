import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type DataSource, type EntityManager } from 'typeorm';
import { RedisService } from '../src/common/redis/redis.service.js';
import { LoginLockoutService } from '../src/common/redis/login-lockout.service.js';
import {
  getLoginFailKey,
  getLoginPendingManualKey,
  getLoginTempLockKey,
} from '../src/common/redis/login-lockout.constants.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import { UserSession } from '../src/modules/auth/entities/user-session.entity.js';

describe('LoginLockoutService atomic Redis state', () => {
  let redis: RedisService;
  let service: LoginLockoutService;
  const ownedIds: string[] = [];
  const nextId = () => {
    const id = `lockout-test:${randomUUID()}`;
    ownedIds.push(id);
    return id;
  };

  beforeAll(async () => {
    redis = new RedisService(new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
      REDIS_PORT: process.env.REDIS_PORT || 6390,
      REDIS_DB: 0,
    }));
    await redis.onModuleInit();
    expect(await redis.getClient().ping()).toBe('PONG');
    service = new LoginLockoutService(redis, {} as DataSource);
  });

  afterAll(async () => {
    if (redis?.getClient()?.status === 'ready') {
      for (const id of ownedIds) await service.resetLoginFailureState(id, 'TEST_CLEANUP', true);
    }
    await redis?.onModuleDestroy();
  });

  it('counts 1,2,3; locks for30s without incrementing; then counts4,5 and persists a no-TTL latch', async () => {
    const id = nextId();
    expect(await service.recordFailure(id)).toEqual({ attempts: 1, tempTtl: 0, pendingManual: false });
    expect(await service.recordFailure(id)).toEqual({ attempts: 2, tempTtl: 0, pendingManual: false });
    expect(await service.recordFailure(id)).toEqual({ attempts: 3, tempTtl: 30, pendingManual: false });
    expect(await redis.ttl(getLoginFailKey(id))).toBeGreaterThanOrEqual(899);
    expect(await redis.ttl(getLoginTempLockKey(id))).toBeGreaterThanOrEqual(29);
    await redis.expire(getLoginFailKey(id), 100);
    expect((await service.recordFailure(id)).attempts).toBe(3);
    expect(await redis.ttl(getLoginFailKey(id))).toBeLessThanOrEqual(100);

    // Only shorten this test's own key; root HTTP E2E checks the actual30s wait.
    await redis.expire(getLoginTempLockKey(id), 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await service.getState(id)).toEqual({ attempts: 3, tempTtl: 0, pendingManual: false });
    expect(await service.recordFailure(id)).toEqual({ attempts: 4, tempTtl: 0, pendingManual: false });
    expect(await service.recordFailure(id)).toEqual({ attempts: 5, tempTtl: 0, pendingManual: true });
    expect(await redis.ttl(getLoginPendingManualKey(id))).toBe(-1);
    expect(await service.recordFailure(id)).toEqual({ attempts: 5, tempTtl: 0, pendingManual: true });
    expect(await redis.get(getLoginFailKey(id))).toBe('5');
  });

  it('renews the900s failure window only on an accepted wrong-password attempt', async () => {
    const id = nextId();
    await service.recordFailure(id);
    expect(await redis.ttl(getLoginFailKey(id))).toBeGreaterThanOrEqual(899);
    await redis.expire(getLoginFailKey(id), 100);
    await service.recordFailure(id);
    expect(await redis.ttl(getLoginFailKey(id))).toBeGreaterThanOrEqual(899);
    await redis.expire(getLoginFailKey(id), 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await service.getState(id)).toEqual({ attempts: 0, tempTtl: 0, pendingManual: false });
    expect((await service.recordFailure(id)).attempts).toBe(1);
  });

  it('serializes concurrent failures without advancing past temporary/manual thresholds', async () => {
    const id = nextId();
    const firstWave = await Promise.all(Array.from({ length: 50 }, () => service.recordFailure(id)));
    expect(firstWave.filter((state) => state.attempts === 1)).toHaveLength(1);
    expect(firstWave.filter((state) => state.attempts === 2)).toHaveLength(1);
    expect((await service.getState(id)).attempts).toBe(3);
    await redis.expire(getLoginTempLockKey(id), 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const secondWave = await Promise.all(Array.from({ length: 50 }, () => service.recordFailure(id)));
    expect(secondWave.filter((state) => state.attempts === 4)).toHaveLength(1);
    expect(await service.getState(id)).toEqual({ attempts: 5, tempTtl: 0, pendingManual: true });
  });

  it('bounds anonymous identifier pending locks to900s without changing lock responses', async () => {
    const id = nextId();
    await service.recordFailure(id, false);
    await service.recordFailure(id, false);
    await service.recordFailure(id, false);
    await redis.expire(getLoginTempLockKey(id), 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await service.recordFailure(id, false);
    await service.recordFailure(id, false);
    expect(await redis.ttl(getLoginPendingManualKey(id))).toBeGreaterThanOrEqual(899);
    expect(() => service.assertNotLocked(null, { attempts: 5, tempTtl: 0, pendingManual: true }))
      .toThrow(UnauthorizedException);
  });

  it('resets failed/temp state on recovery while retaining the manual latch until explicit unlock', async () => {
    const id = nextId();
    await redis.set(getLoginFailKey(id), '5', 900);
    await redis.set(getLoginTempLockKey(id), '1', 30);
    await redis.set(getLoginPendingManualKey(id), '1');
    await service.resetLoginFailureState(id, 'PASSWORD_RESET');
    expect(await service.getState(id)).toEqual({ attempts: 0, tempTtl: 0, pendingManual: true });
    expect((await service.recordFailure(id)).attempts).toBe(0);
    await service.resetLoginFailureState(id, 'MANUAL_UNLOCK', true);
    expect(await service.getState(id)).toEqual({ attempts: 0, tempTtl: 0, pendingManual: false });
  });

  it('resets temporary lock/counter after successful authentication without touching other users', async () => {
    const id = nextId();
    const otherId = nextId();
    await service.recordFailure(otherId);
    await service.recordFailure(id);
    await service.recordFailure(id);
    await service.recordFailure(id);
    await service.resetLoginFailureState(id, 'OTP_LOGIN');
    expect(await service.getState(id)).toEqual({ attempts: 0, tempTtl: 0, pendingManual: false });
    expect((await service.getState(otherId)).attempts).toBe(1);
  });

  it('fails closed on corrupt Redis counters', async () => {
    const id = nextId();
    await redis.set(getLoginFailKey(id), 'corrupt', 900);
    await expect(service.getState(id)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.recordFailure(id)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uses one Redis counter/temp/pending namespace for uppercase and lowercase UUIDs', async () => {
    const id = nextId();
    const upperId = id.toUpperCase();
    expect(getLoginFailKey(upperId)).toBe(getLoginFailKey(id));
    expect(getLoginTempLockKey(upperId)).toBe(getLoginTempLockKey(id));
    expect(getLoginPendingManualKey(upperId)).toBe(getLoginPendingManualKey(id));
    await service.recordFailure(upperId);
    await service.recordFailure(id);
    expect((await service.getState(upperId)).attempts).toBe(2);
    await service.recordFailure(upperId);
    expect((await service.getState(id)).tempTtl).toBeGreaterThanOrEqual(29);
    await service.resetLoginFailureState(upperId, 'TEST_CASE_NORMALIZATION', true);
    expect((await service.getState(id)).attempts).toBe(0);
  });
});

describe('LoginLockoutService guards and PostgreSQL serialization', () => {
  const makeService = (redis: Partial<RedisService> = {}, dataSource: Partial<DataSource> = {}) =>
    new LoginLockoutService(redis as RedisService, dataSource as DataSource);
  const makeUser = (overrides: Partial<User> = {}) => Object.assign(new User(), {
    userId: randomUUID(), isLocked: false, isActive: true, tokenVersion: 7, ...overrides,
  });

  it('returns generic 401 for a durable lock and 429 with remaining TTL for temporary locks', () => {
    const service = makeService();
    expect(() => service.assertNotLocked(makeUser({ isLocked: true })))
      .toThrow(UnauthorizedException);
    try {
      service.assertNotLocked(makeUser(), { attempts: 3, tempTtl: 21, pendingManual: false });
      expect.fail('temporary lock must reject login');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({ retryAfterSeconds: 21, retryAfter: 21 });
    }
    expect(() => service.assertNotLocked(makeUser(), { attempts: 3, tempTtl: 21, pendingManual: false }, false))
      .not.toThrow();
  });

  it('rejects missing/inactive users and a fifth-attempt state with a missing pending key', () => {
    const service = makeService();
    expect(() => service.assertNotLocked(null)).toThrow(UnauthorizedException);
    expect(() => service.assertNotLocked(makeUser({ isActive: false }))).toThrow(UnauthorizedException);
    expect(() => service.assertNotLocked(makeUser(), { attempts: 5, tempTtl: 0, pendingManual: false }))
      .toThrow(UnauthorizedException);
    try {
      service.assertNotLocked(null, { attempts: 3, tempTtl: 30, pendingManual: false });
      expect.fail('unknown identifiers must get the same temporary response');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });

  it('fails closed when Redis is absent or any state/reset operation fails', async () => {
    const absent = makeService({ getClient: vi.fn(() => undefined as never) });
    await expect(absent.getState('id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(absent.recordFailure('id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(absent.resetLoginFailureState('id', 'LOGIN')).rejects.toBeInstanceOf(ServiceUnavailableException);
    const broken = makeService({ getClient: vi.fn(() => ({ eval: vi.fn().mockRejectedValue(new Error('offline')) }) as never) });
    await expect(broken.getState('id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(broken.recordFailure('id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(broken.resetLoginFailureState('id', 'LOGIN')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('persists LOGIN_FAILED once, increments token version and revokes sessions without changing isActive', async () => {
    const user = makeUser();
    const manager = { save: vi.fn(), update: vi.fn() } as unknown as EntityManager;
    const service = makeService();
    await service.persistManualLock(manager, user);
    expect(user).toMatchObject({ isLocked: true, tokenVersion: 8, isActive: true });
        expect(manager.save).toHaveBeenCalledWith(User, user);
    expect(manager.update).toHaveBeenCalledWith(UserSession, expect.objectContaining({ userId: user.userId }), expect.objectContaining({
      revokeReason: 'LOGIN_FAILED_LOCK',
      revokedAt: expect.any(Date)
    }));
    await service.persistManualLock(manager, user);
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(user.tokenVersion).toBe(8);
  });

  it('does not mutate an already durable-locked user', async () => {
    const user = makeUser({ isLocked: true });
    const original = { ...user };
    const manager = { save: vi.fn(), update: vi.fn() } as unknown as EntityManager;
    await makeService().persistManualLock(manager, user);
    expect({ ...user }).toEqual(original);
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });

  function transactionFixture() {
    const history: string[] = [];
    const users = new Map([['a', makeUser({ userId: 'a' })], ['z', makeUser({ userId: 'z' })]]);
    let queryId = '';
    const builder = {
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn((_clause: string, params: { userId: string }) => { queryId = params.userId; return builder; }),
      setLock: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => { history.push(`row:${queryId}`); return users.get(queryId) ?? null; }),
    };
    const connection = { end: vi.fn(async () => { history.push('connection-end'); }) };
    const runner = {
      manager: { createQueryBuilder: vi.fn(() => builder) },
      isTransactionActive: false,
      connect: vi.fn(async () => { history.push('connect'); return connection; }),
      query: vi.fn(async (sql: string, params: string[] = []) => { history.push(`${sql.includes('unlock') ? 'unlock' : 'lock'}:${params[0] ?? 'all'}`); }),
      startTransaction: vi.fn(async () => { runner.isTransactionActive = true; history.push('begin'); }),
      commitTransaction: vi.fn(async () => { runner.isTransactionActive = false; history.push('commit'); }),
      rollbackTransaction: vi.fn(async () => { runner.isTransactionActive = false; history.push('rollback'); }),
      release: vi.fn(async () => { history.push('release'); }),
    };
    const service = makeService({}, { createQueryRunner: vi.fn(() => runner as never) });
    return { history, runner, builder, service, connection };
  }

  it('sorts/deduplicates advisory locks, locks rows and holds locks through after-commit work', async () => {
    const { service, history, builder } = transactionFixture();
    const result = await service.withUsersLock(['z', 'a', 'z'], async (users, _manager, afterCommit) => {
      expect([...users.keys()]).toEqual(['a', 'z']);
      afterCommit(async () => { history.push('redis-reset'); });
      history.push('update');
      return 42;
    });
    expect(result).toBe(42);
    expect(history).toEqual(['connect', 'lock:auth:user:a', 'lock:auth:user:z', 'begin', 'row:a', 'row:z', 'update', 'commit', 'redis-reset', 'unlock:auth:user:z', 'unlock:auth:user:a', 'release']);
    expect(builder.addSelect).toHaveBeenCalledWith('user.passwordHash');
    expect(builder.setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  it('canonicalizes case before locking and deduplicates equivalent UUID spellings', async () => {
    const { service, history } = transactionFixture();
    await service.withUsersLock(['Z', 'a', 'A', 'z'], async (users) => {
      expect([...users.keys()]).toEqual(['a', 'z']);
    });
    expect(history.filter((event) => event.startsWith('lock:'))).toEqual(['lock:auth:user:a', 'lock:auth:user:z']);
    const user = await service.withUserLock('A', async (user) => user);
    expect(user?.userId).toBe('a');
  });

  it('rolls back failed database work and does not run success cleanup', async () => {
    const { service, history } = transactionFixture();
    await expect(service.withUserLock('a', async (_user, _manager, afterCommit) => {
      afterCommit(async () => { history.push('redis-reset'); });
      throw new Error('database update failed');
    })).rejects.toThrow('database update failed');
    expect(history).toEqual(['connect', 'lock:auth:user:a', 'begin', 'row:a', 'rollback', 'unlock:auth:user:a', 'release']);
  });

  it('commits before Redis cleanup and releases locks if cleanup fails, without delivering callback result', async () => {
    const { service, history, runner } = transactionFixture();
    await expect(service.withUserLock('a', async (_user, _manager, afterCommit) => {
      afterCommit(async () => { throw new ServiceUnavailableException('offline'); });
      return 'token';
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(history).toEqual(['connect', 'lock:auth:user:a', 'begin', 'row:a', 'commit', 'unlock:auth:user:a', 'release']);
  });

  it('falls back to clearing its session advisory locks if individual unlock fails', async () => {
    const { service, runner, connection } = transactionFixture();
    await expect(service.withUserLock('a', async (_user, _manager, afterCommit) => {
      afterCommit(async () => { runner.query.mockRejectedValueOnce(new Error('unlock failed')); });
      return 'token';
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(runner.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock_all()');
    expect(connection.end).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledOnce();
  });

  it('destroys the PostgreSQL connection if advisory unlock cannot be confirmed', async () => {
    const { service, runner, connection } = transactionFixture();
    await expect(service.withUserLock('a', async (_user, _manager, afterCommit) => {
      afterCommit(async () => { runner.query.mockRejectedValue(new Error('connection unavailable')); });
      return 'token';
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(connection.end).toHaveBeenCalledOnce();
    expect(runner.release).toHaveBeenCalledOnce();
  });
});
