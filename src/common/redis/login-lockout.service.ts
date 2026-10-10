import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { User } from '../../modules/users/entities/user.entity.js';
import { UserSession } from '../../modules/auth/entities/user-session.entity.js';
import { RedisService } from './redis.service.js';
import {
  LOGIN_LOCKOUT_CONFIG,
  getLoginFailKey,
  getLoginPendingManualKey,
  getLoginTempLockKey,
} from './login-lockout.constants.js';

export interface LoginLockoutState {
  attempts: number;
  tempTtl: number;
  pendingManual: boolean;
}

export type AfterCommit = (job: () => Promise<void>) => void;

const STATE_SCRIPT = `
  local attempts = tonumber(redis.call('GET', KEYS[1]) or '0')
  if not attempts or attempts < 0 then return redis.error_reply('Invalid login counter') end
  local ttl = 0
  if redis.call('EXISTS', KEYS[2]) == 1 then
    ttl = math.max(1, redis.call('TTL', KEYS[2]))
  end
  local pending = redis.call('EXISTS', KEYS[3])
  if attempts >= ${LOGIN_LOCKOUT_CONFIG.MANUAL_LOCK_THRESHOLD} then pending = 1 end
  return {attempts, ttl, pending}
`;

const FAILURE_SCRIPT = `
  local attempts = tonumber(redis.call('GET', KEYS[1]) or '0')
  if not attempts or attempts < 0 then return redis.error_reply('Invalid login counter') end
  local pending = redis.call('EXISTS', KEYS[3])
  local ttl = 0
  if redis.call('EXISTS', KEYS[2]) == 1 then
    ttl = math.max(1, redis.call('TTL', KEYS[2]))
  end
  if pending == 1 or ttl > 0 then return {attempts, ttl, pending} end

  attempts = math.min(attempts + 1, tonumber(ARGV[4]))
  redis.call('SET', KEYS[1], attempts, 'EX', ARGV[1])
  if attempts == tonumber(ARGV[2]) then
    redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
    ttl = tonumber(ARGV[3])
  elseif attempts >= tonumber(ARGV[4]) then
    if tonumber(ARGV[5]) > 0 then
      redis.call('SET', KEYS[3], '1', 'EX', ARGV[5])
    else
      redis.call('SET', KEYS[3], '1')
    end
    pending = 1
  end
  return {attempts, ttl, pending}
`;

const RESET_SCRIPT = `
  redis.call('DEL', KEYS[1], KEYS[2])
  if ARGV[1] == '1' then redis.call('DEL', KEYS[3]) end
  return 1
`;

@Injectable()
export class LoginLockoutService {
  constructor(
    private readonly redisService: RedisService,
    private readonly dataSource: DataSource,
  ) {}

  private keys(userId: string): [string, string, string] {
    return [
      getLoginFailKey(userId),
      getLoginTempLockKey(userId),
      getLoginPendingManualKey(userId),
    ];
  }

  private async evalState(
    script: string,
    userId: string,
    args: number[] = [],
  ): Promise<LoginLockoutState> {
    try {
      const client = this.redisService.getClient();
      if (!client) throw new Error('Redis unavailable');
      const result = (await client.eval(script, 3, ...this.keys(userId), ...args)) as number[];
      if (!Array.isArray(result) || result.length !== 3) throw new Error('Invalid Redis state');
      return {
        attempts: Number(result[0]),
        tempTtl: Number(result[1]),
        pendingManual: Number(result[2]) === 1,
      };
    } catch {
      throw new ServiceUnavailableException('Dịch vụ xác thực tạm thời không khả dụng.');
    }
  }

  getState(userId: string): Promise<LoginLockoutState> {
    return this.evalState(STATE_SCRIPT, userId);
  }

  /** Unknown identifiers get the same responses but a bounded, anonymous latch. */
  recordFailure(userId: string, persistentManualLock = true): Promise<LoginLockoutState> {
    return this.evalState(FAILURE_SCRIPT, userId, [
      LOGIN_LOCKOUT_CONFIG.FAILURE_WINDOW_SECONDS,
      LOGIN_LOCKOUT_CONFIG.TEMP_LOCK_THRESHOLD,
      LOGIN_LOCKOUT_CONFIG.TEMP_LOCK_SECONDS,
      LOGIN_LOCKOUT_CONFIG.MANUAL_LOCK_THRESHOLD,
      persistentManualLock ? 0 : LOGIN_LOCKOUT_CONFIG.FAILURE_WINDOW_SECONDS,
    ]);
  }

  /** Recovery clears counters, never the manual-lock latch; only explicit unlock can clear it. */
  async resetLoginFailureState(
    userId: string,
    _reason: string,
    manualUnlock = false,
  ): Promise<void> {
    try {
      const client = this.redisService.getClient();
      if (!client) throw new Error('Redis unavailable');
      await client.eval(RESET_SCRIPT, 3, ...this.keys(userId), manualUnlock ? '1' : '0');
    } catch {
      throw new ServiceUnavailableException('Dịch vụ xác thực tạm thời không khả dụng.');
    }
  }

  /** Use the same generic rejection for unknown, inactive and manually locked users. */
  assertNotLocked(
    user: User | null,
    state?: LoginLockoutState,
    checkTemporary = true,
  ): void {
    if (user?.isLocked || state?.pendingManual || (state?.attempts ?? 0) >= LOGIN_LOCKOUT_CONFIG.MANUAL_LOCK_THRESHOLD) {
      throw new UnauthorizedException('Số điện thoại hoặc mật khẩu không đúng!');
    }
    if (checkTemporary && state && state.tempTtl > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Tạm thời không thể đăng nhập. Vui lòng thử lại sau.',
          retryAfterSeconds: state.tempTtl,
          retryAfter: state.tempTtl,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Số điện thoại hoặc mật khẩu không đúng!');
    }
  }

  lockUser(manager: EntityManager, userId: string): Promise<User | null> {
    return manager
      .createQueryBuilder(User, 'user')
      .addSelect('user.passwordHash')
      .where('user.userId = :userId', { userId })
      .setLock('pessimistic_write')
      .getOne();
  }

  /**
   * Session advisory locks span PostgreSQL commit AND Redis cleanup. Acquiring
   * sorted IDs before row locks gives every auth/unlock path the same ordering.
   * After-commit jobs never run after a rolled-back password/session update.
   */
  async withUsersLock<T>(
    userIds: string[],
    callback: (
      users: Map<string, User | null>,
      manager: EntityManager,
      afterCommit: AfterCommit,
    ) => Promise<T>,
  ): Promise<T> {
    const ids = [...new Set(userIds.map((id) => id.toLowerCase()))].sort();
    const runner = this.dataSource.createQueryRunner();
    const heldIds: string[] = [];
    let connection: { end?: () => Promise<void> } | undefined;
    let result!: T;
    let operationFailed = false;
    let operationError: unknown;
    let cleanupFailed = false;
    try {
      connection = await runner.connect();
      for (const id of ids) {
        await runner.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`auth:user:${id}`]);
        heldIds.push(id);
      }
      await runner.startTransaction();
      const users = new Map<string, User | null>();
      for (const id of ids) users.set(id, await this.lockUser(runner.manager, id));
      const jobs: Array<() => Promise<void>> = [];
      result = await callback(users, runner.manager, (job) => jobs.push(job));
      await runner.commitTransaction();
      for (const job of jobs) await job();
    } catch (error) {
      operationFailed = true;
      operationError = error;
      if (runner.isTransactionActive) {
        try {
          await runner.rollbackTransaction();
        } catch {
          cleanupFailed = true;
        }
      }
    } finally {
      try {
        for (const id of heldIds.reverse()) {
          await runner.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`auth:user:${id}`]);
        }
      } catch {
        cleanupFailed = true;
        try {
          await runner.query('SELECT pg_advisory_unlock_all()');
        } catch {
          // Do not return a session still holding advisory locks to the pool.
          // QueryRunner.connect() returns the underlying PostgreSQL client.
          if (connection?.end) {
            try {
              await connection.end();
            } catch {
              cleanupFailed = true;
            }
          }
        }
      } finally {
        try {
          await runner.release();
        } catch {
          cleanupFailed = true;
        }
      }
    }
    if (cleanupFailed) {
      throw new ServiceUnavailableException('Dịch vụ xác thực tạm thời không khả dụng.');
    }
    if (operationFailed) throw operationError;
    return result;
  }

  withUserLock<T>(
    userId: string,
    callback: (user: User | null, manager: EntityManager, afterCommit: AfterCommit) => Promise<T>,
  ): Promise<T> {
    return this.withUsersLock([userId], (users, manager, afterCommit) =>
      callback(users.get(userId.toLowerCase()) ?? null, manager, afterCommit),
    );
  }

  /** Caller commits durable lock and session revocation before rejecting login. */
  async persistManualLock(manager: EntityManager, user: User): Promise<void> {
    if (user.isLocked) return;
    const now = new Date();
    user.isLocked = true;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await manager.save(User, user);
    await manager.update(
      UserSession,
      { userId: user.userId, revokedAt: IsNull() },
      { revokedAt: now, revokeReason: 'LOGIN_FAILED_LOCK' },
    );
  }
}
