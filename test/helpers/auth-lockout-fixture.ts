// Adapter for existing direct AuthService unit fixtures. Production always uses
// LoginLockoutService; these fixtures model the transaction/after-commit boundary.
import { vi } from 'vitest';
import { HttpException, UnauthorizedException } from '@nestjs/common';

export function authLockoutFixture(users: any, dataSource: any) {
  return {
    getState: vi.fn().mockResolvedValue({ attempts: 0, tempTtl: 0, pendingManual: false }),
    resetLoginFailureState: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue({ attempts: 1, tempTtl: 0, pendingManual: false }),
    persistManualLock: vi.fn(),
    assertNotLocked: vi.fn((user: any, state?: any, checkTemporary = true) => {
      if (!user || !user.isActive) {
        if (checkTemporary && state && state.tempTtl > 0) {
          throw new HttpException(
            {
              statusCode: 429,
              message: 'Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau 30 giây.',
              errorCode: 'ACCOUNT_TEMPORARILY_LOCKED',
              retryAfterSeconds: state.tempTtl,
              retryAfter: state.tempTtl,
            },
            429,
          );
        }
        throw new UnauthorizedException();
      }
      if (user.isLocked || state?.pendingManual || (state?.attempts ?? 0) >= 5) {
        if (checkTemporary) {
          throw new HttpException(
            {
              statusCode: 423,
              message: 'Tài khoản đã bị khóa do đăng nhập sai quá số lần cho phép. Vui lòng liên hệ quản trị viên để được mở khóa.',
              errorCode: 'ACCOUNT_PENDING_ADMIN_UNLOCK',
            },
            423,
          );
        }
        throw new UnauthorizedException();
      }
      if (checkTemporary && state && state.tempTtl > 0) {
        throw new HttpException(
          {
            statusCode: 429,
            message: 'Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau 30 giây.',
            errorCode: 'ACCOUNT_TEMPORARILY_LOCKED',
            retryAfterSeconds: state.tempTtl,
            retryAfter: state.tempTtl,
          },
          429,
        );
      }
    }),
    withUserLock: vi.fn(async (id: string, callback: any) => {
      const jobs: Array<() => Promise<void>> = [];
      const result = await dataSource.transaction(async (manager: any) => {
        let user = await users.findById(id, true);
        // Some legacy reset fixtures stub only the original phone lookup.
        if (!user && users.findByPhoneNumber?.mock?.results?.length) {
          const candidate = await users.findByPhoneNumber.mock.results.at(-1).value;
          if (candidate?.userId === id) user = candidate;
        }
        return callback(user, manager, (job: () => Promise<void>) => jobs.push(job));
      });
      for (const job of jobs) await job();
      return result;
    }),
  };
}
