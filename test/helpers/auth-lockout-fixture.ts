// Adapter for existing direct AuthService unit fixtures. Production always uses
// LoginLockoutService; these fixtures model the transaction/after-commit boundary.
import { vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

export function authLockoutFixture(users: any, dataSource: any) {
  return {
    getState: vi.fn().mockResolvedValue({ attempts: 0, tempTtl: 0, pendingManual: false }),
    resetLoginFailureState: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue({ attempts: 1, tempTtl: 0, pendingManual: false }),
    persistManualLock: vi.fn(),
    assertNotLocked: vi.fn((user: any, state?: any) => {
      if (!user || !user.isActive || user.isLocked || state?.pendingManual) throw new UnauthorizedException();
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
