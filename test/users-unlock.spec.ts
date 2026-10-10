import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, InternalServerErrorException, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../src/common/enums/role.enum.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { UnlockUserDto } from '../src/modules/users/dto/unlock-user.dto.js';

describe('Manual unlock authorization and durable lock preservation', () => {
  let actor: User;
  let target: User;
  let manager: any;
  let lockout: any;
  let users: UsersService;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    actor = {
      userId: 'actor-id', role: Role.ADMIN, isActive: true, isLocked: false,
      tokenVersion: 4,
    } as User;
    target = {
      userId: 'target-id', role: Role.FARMER, isActive: true, isLocked: true,

      tokenVersion: 7,
    } as User;
    manager = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
    lockout = {
      getState: vi.fn().mockResolvedValue({ attempts: 0, tempTtl: 0, pendingManual: false }),
      resetLoginFailureState: vi.fn().mockResolvedValue(undefined),
      withUsersLock: vi.fn(async (ids: string[], operation: any) => {
        const afterCommit: Array<() => Promise<void>> = [];
        const rows = new Map([[actor.userId, actor], [target.userId, target]]);
        expect(ids).toEqual([actor.userId, target.userId]);
        const result = await operation(rows, manager, (job: () => Promise<void>) => afterCommit.push(job));
        for (const job of afterCommit) await job();
        return result;
      }),
    };
    users = new UsersService({} as any, lockout);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  it.each([
    [Role.ADMIN, Role.ADMIN], [Role.ADMIN, Role.MANAGER], [Role.ADMIN, Role.FARMER],
    [Role.MANAGER, Role.MANAGER], [Role.MANAGER, Role.FARMER],
  ])('%s can unlock a different %s', async (actorRole, targetRole) => {
    actor.role = actorRole;
    target.role = targetRole;
    await expect(users.unlockUser(actor.userId, target.userId, 'Identity verified')).resolves.toEqual({
      message: 'Mở khóa tài khoản thành công!', userId: target.userId,
    });
    expect(manager.update).toHaveBeenCalledWith(User, { userId: target.userId }, {
      isLocked: false,
    });
    expect(lockout.resetLoginFailureState).toHaveBeenCalledWith(target.userId, 'MANUAL_UNLOCK', true);
    // Unlock never rewinds tokenVersion or restores a revoked session.
    expect(target.tokenVersion).toBe(7);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it.each([
    [Role.MANAGER, Role.ADMIN], [Role.FARMER, Role.ADMIN],
    [Role.FARMER, Role.MANAGER], [Role.FARMER, Role.FARMER],
  ])('%s cannot unlock %s', async (actorRole, targetRole) => {
    actor.role = actorRole;
    target.role = targetRole;
    await expect(users.unlockUser(actor.userId, target.userId, 'Attempt')).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(target.isLocked).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it.each([Role.ADMIN, Role.MANAGER])('%s cannot unlock itself even in a direct service call', async (role) => {
    actor.role = role;
    await expect(users.unlockUser(actor.userId, actor.userId, 'Attempt')).rejects.toBeInstanceOf(ForbiddenException);
    expect(lockout.withUsersLock).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it.each(['durable', 'inactive', 'pending'])('rejects %s actor state loaded from the database/Redis', async (state) => {
    if (state === 'durable') actor.isLocked = true;
    if (state === 'inactive') actor.isActive = false;
    if (state === 'pending') lockout.getState.mockResolvedValue({ attempts: 5, tempTtl: 0, pendingManual: true });
    await expect(users.unlockUser(actor.userId, target.userId, 'Attempt')).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('allows an authorized unlock of an inactive target without reactivating it', async () => {
    target.isActive = false;
    await expect(users.unlockUser(actor.userId, target.userId, 'Attempt')).resolves.toEqual({
      message: 'Mở khóa tài khoản thành công!',
      userId: target.userId,
    });
    expect(manager.update).toHaveBeenCalledWith(
      User,
      { userId: target.userId },
      { isLocked: false },
    );
    expect(lockout.resetLoginFailureState).toHaveBeenCalledWith(target.userId, 'MANUAL_UNLOCK', true);
    expect(target.isActive).toBe(false);
  });

  it('makes repeated authorized unlock idempotent without changing activation state', async () => {
    target.isLocked = false;
        await users.unlockUser(actor.userId, target.userId, 'Identity verified');
    expect(manager.update).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).toHaveBeenCalledWith(target.userId, 'MANUAL_UNLOCK', true);
    expect(target.isActive).toBe(true);
  });

  it('fails closed when lockout storage is not available', async () => {
    users = new UsersService({} as any);
    await expect(users.unlockUser(actor.userId, target.userId, 'Attempt')).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('propagates Redis errors before any lock state is changed', async () => {
    lockout.getState.mockRejectedValue(new InternalServerErrorException('Unavailable'));
    await expect(users.unlockUser(actor.userId, target.userId, 'Attempt')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('does not clear Redis when the database lock update fails', async () => {
    manager.update.mockRejectedValue(new Error('Database unavailable'));
    await expect(users.unlockUser(actor.userId, target.userId, 'Attempt')).rejects.toThrow('Database unavailable');
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('requires a nonblank bounded reason in the request contract', async () => {
    for (const reason of ['', '   ', 'x'.repeat(201), 42, undefined]) {
      const dto = plainToInstance(UnlockUserDto, { reason });
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
    const dto = plainToInstance(UnlockUserDto, { reason: '  Identity verified  ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.reason).toBe('Identity verified');
  });
});

describe('Unrelated user updates cannot overwrite durable authentication state', () => {
  it('writes profile fields only, preserving a concurrent lock and tokenVersion', async () => {
    const before = {
      userId: 'user-id', phoneNumber: '0908123456', fullName: 'Before', email: null,
      gender: null, dateOfBirth: null, isActive: true, isLocked: false, tokenVersion: 1,
    } as User;
    const after = { ...before, fullName: 'After', isLocked: true, tokenVersion: 2 } as User;
    const repository = {
      findOne: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      save: vi.fn(),
    };
    const users = new UsersService(repository as any);
    const response = await users.updateProfile(before.userId, { fullName: 'After' });
    expect(repository.update).toHaveBeenCalledWith({ userId: before.userId }, { fullName: 'After' });
    expect(repository.save).not.toHaveBeenCalled();
    expect(response.isLocked).toBe(true);
    expect(response.tokenVersion).toBe(2);
  });

  it('updates administrative fields selectively and atomically increments tokenVersion', async () => {
    const before = {
      userId: 'user-id', role: Role.FARMER, isActive: true, isLocked: false, tokenVersion: 1,
    } as User;
    const after = { ...before, role: Role.MANAGER, isLocked: true, tokenVersion: 3 } as User;
    const repository = {
      findOne: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      save: vi.fn(),
    };
    const users = new UsersService(repository as any);
    const response = await users.adminUpdateUser(before.userId, { role: Role.MANAGER });
    const [criteria, patch] = repository.update.mock.calls[0];
    expect(criteria).toEqual({ userId: before.userId });
    expect(Object.keys(patch)).toEqual(['role', 'tokenVersion']);
    expect(patch.role).toBe(Role.MANAGER);
    expect(patch.tokenVersion()).toBe('"token_version" + 1');
    expect(repository.save).not.toHaveBeenCalled();
    expect(response.isLocked).toBe(true);
    expect(response.tokenVersion).toBe(3);
  });
});
