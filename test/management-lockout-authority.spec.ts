import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../src/modules/users/users.service.js';
import { UsersController } from '../src/modules/users/users.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import { Role } from '../src/common/enums/role.enum.js';

describe('P0-3 management authority cannot bypass manual unlock hierarchy', () => {
  const actorId = 'aa000000-0000-4000-8000-000000000001';
  const targetId = 'bb000000-0000-4000-8000-000000000002';
  let actor: User;
  let target: User;
  let repo: any;
  let lockout: any;
  let users: UsersService;
  let store: Map<string, User>;

  beforeEach(() => {
    actor = Object.assign(new User(), {
      userId: actorId, fullName: 'Test Manager', role: Role.MANAGER,
      phoneNumber: '0999111101', isActive: true, isLocked: false,
      passwordHash: 'discarded-test-value', tokenVersion: 7,
    });
    target = Object.assign(new User(), {
      userId: targetId, fullName: 'Test Farmer', role: Role.FARMER,
      phoneNumber: '0999111102', isActive: true, isLocked: true,
      tokenVersion: 11,
      passwordHash: 'discarded-test-value',
    });
    store = new Map([[actorId, actor], [targetId, target]]);
    repo = {
      findOne: vi.fn(async (options: any) => {
        const where = options.where;
        if (where.userId) return store.get(where.userId) ?? null;
        if (where.phoneNumber) return [...store.values()].find((user) => user.phoneNumber === where.phoneNumber) ?? null;
        if (where.email) return [...store.values()].find((user) => user.email === where.email) ?? null;
        return null;
      }),
      create: vi.fn((values: any) => Object.assign(new User(), { userId: 'cc000000-0000-4000-8000-000000000003' }, values)),
      save: vi.fn(async (value: User) => { store.set(value.userId, value); return value; }),
      update: vi.fn(async (criteria: any, patch: any) => {
        const value = store.get(criteria.userId);
        if (!value) return { affected: 0 };
        for (const [key, field] of Object.entries(patch)) {
          if (key === 'tokenVersion' && typeof field === 'function') value.tokenVersion += 1;
          else (value as any)[key] = field;
        }
        return { affected: 1 };
      }),
      delete: vi.fn(async (criteria: any) => {
        const value = store.get(criteria.userId);
        if (!value || (criteria.role?.type === 'not' && value.role === criteria.role.value)) {
          return { affected: 0 };
        }
        store.delete(criteria.userId);
        return { affected: 1 };
      }),
    };
    lockout = {
      getState: vi.fn(async () => ({ attempts: 0, tempTtl: 0, pendingManual: false })),
      withUsersLock: vi.fn(), resetLoginFailureState: vi.fn(),
    };
    users = new UsersService(repo, lockout);
  });

  const create = (role: Role) => users.createUserByAdmin({
    fullName: 'Isolated Created User', phoneNumber: '0999111103',
    password: 'ManagementTest@2026', role,
  }, actorId);
  const expectNoWrites = () => {
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  };

  it('MANAGER cannot promote their own account to ADMIN', async () => {
    await expect(users.adminUpdateUser(actorId, { role: Role.ADMIN }, actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoWrites();
    expect(actor.role).toBe(Role.MANAGER);
  });

  it('MANAGER cannot promote another account to ADMIN', async () => {
    await expect(users.adminUpdateUser(targetId, { role: Role.ADMIN }, actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoWrites();
    expect(target.role).toBe(Role.FARMER);
  });

  it('MANAGER cannot create ADMIN accounts', async () => {
    await expect(create(Role.ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoWrites();
  });

  it('MANAGER cannot downgrade an existing ADMIN to gain authority over them', async () => {
    target.role = Role.ADMIN;
    await expect(users.adminUpdateUser(targetId, { role: Role.FARMER }, actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoWrites();
    expect(target.role).toBe(Role.ADMIN);
  });

  it('MANAGER cannot modify an existing ADMIN even without changing their role', async () => {
    target.role = Role.ADMIN;
    await expect(users.adminUpdateUser(targetId, { fullName: 'Attempted bypass' }, actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoWrites();
  });

  it('MANAGER cannot delete an existing ADMIN and the row remains unchanged', async () => {
    target.role = Role.ADMIN;
    const before = { ...target };
    await expect(users.deleteUser(targetId, actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.delete).not.toHaveBeenCalled();
    expect(store.get(targetId)).toMatchObject(before);
  });

  it('MANAGER can delete a FARMER using a conditional non-ADMIN delete', async () => {
    await expect(users.deleteUser(targetId, actorId)).resolves.toEqual({
      message: 'Xóa người dùng thành công!',
    });
    const criteria = repo.delete.mock.calls[0][0];
    expect(criteria.userId).toBe(targetId);
    expect(criteria.role.type).toBe('not');
    expect(criteria.role.value).toBe(Role.ADMIN);
    expect(store.has(targetId)).toBe(false);
  });

  it('returns Forbidden and preserves the row if a delete target becomes ADMIN after authorization', async () => {
    repo.delete.mockImplementationOnce(async () => {
      target.role = Role.ADMIN;
      return { affected: 0 };
    });
    await expect(users.deleteUser(targetId, actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.get(targetId)?.role).toBe(Role.ADMIN);
  });

  it('ADMIN can delete an ADMIN under the existing unrestricted ADMIN policy', async () => {
    actor.role = Role.ADMIN;
    target.role = Role.ADMIN;
    await expect(users.deleteUser(targetId, actorId)).resolves.toEqual({
      message: 'Xóa người dùng thành công!',
    });
    expect(repo.delete).toHaveBeenCalledWith({ userId: targetId });
    expect(store.has(targetId)).toBe(false);
  });

  it('ADMIN can promote another account to ADMIN without overwriting the durable lock', async () => {
    actor.role = Role.ADMIN;
    const result = await users.adminUpdateUser(targetId, { role: Role.ADMIN }, actorId);
    expect(result.role).toBe(Role.ADMIN);
    expect(repo.update).toHaveBeenCalledWith({ userId: targetId }, expect.objectContaining({ role: Role.ADMIN }));
    const patch = repo.update.mock.calls[0][1];
    expect(patch).not.toHaveProperty('isLocked');
        expect(result.isLocked).toBe(true);
    expect(result.tokenVersion).toBe(12);
  });

  it('ADMIN can create ADMIN accounts using current database authority', async () => {
    actor.role = Role.ADMIN;
    const result = await create(Role.ADMIN);
    expect(result.role).toBe(Role.ADMIN);
    expect(result).not.toHaveProperty('passwordHash');
    expect(repo.save).toHaveBeenCalledOnce();
    expect(lockout.getState).toHaveBeenCalledWith(actorId);
  });

  it('MANAGER can change another MANAGER to FARMER with a conditional update and atomic token version increment', async () => {
    target.role = Role.MANAGER;
    const result = await users.adminUpdateUser(targetId, { role: Role.FARMER }, actorId);
    expect(result.role).toBe(Role.FARMER);
    const [criteria, patch] = repo.update.mock.calls[0];
    expect(criteria.userId).toBe(targetId);
    expect(criteria.role.type).toBe('not');
    expect(criteria.role.value).toBe(Role.ADMIN);
    expect(typeof patch.tokenVersion).toBe('function');
    expect(patch.tokenVersion()).toBe('"token_version" + 1');
    expect(result.tokenVersion).toBe(12);
    expect(patch).not.toHaveProperty('isLocked');
      });

  it('rejects with Forbidden if a MANAGER update target became ADMIN after the authority lookup', async () => {
    repo.update.mockResolvedValueOnce({ affected: 0 });
    repo.findOne.mockImplementationOnce(async () => actor).mockImplementationOnce(async () => target).mockImplementationOnce(async () => {
      target.role = Role.ADMIN;
      return target;
    });
    await expect(users.adminUpdateUser(targetId, { fullName: 'Concurrent update' }, actorId)).rejects.toBeInstanceOf(ForbiddenException);
    const criteria = repo.update.mock.calls[0][0];
    expect(criteria.role.type).toBe('not');
    expect(criteria.role.value).toBe(Role.ADMIN);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it.each(['LOCKED', 'INACTIVE', 'PENDING', 'FARMER', 'MISSING'] as const)('rejects management writes when fresh database actor is %s', async (condition) => {
    if (condition === 'LOCKED') actor.isLocked = true;
    if (condition === 'INACTIVE') actor.isActive = false;
    if (condition === 'FARMER') actor.role = Role.FARMER;
    if (condition === 'MISSING') store.delete(actorId);
    if (condition === 'PENDING') lockout.getState.mockResolvedValue({ attempts: 5, tempTtl: 0, pendingManual: true });
    await expect(users.adminUpdateUser(targetId, { fullName: 'Denied edit' }, actorId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(create(Role.FARMER)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoWrites();
  });

  it('does not trust stale actor role supplied by callers over the database', async () => {
    actor.role = Role.FARMER;
    await expect(users.assertManagementAuthority(actorId, targetId, Role.ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { userId: actorId } });
    expectNoWrites();
  });

  it('fails closed when the actor lockout state cannot be checked', async () => {
    lockout.getState.mockRejectedValueOnce(new ServiceUnavailableException());
    await expect(users.adminUpdateUser(targetId, { fullName: 'Denied edit' }, actorId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expectNoWrites();
  });

  it('fails closed if authority is checked without the lockout service', async () => {
    const unconfigured = new UsersService(repo);
    await expect(unconfigured.assertManagementAuthority(actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoWrites();
  });

  it('does not allow creating or promoting ADMIN without a server actor', async () => {
    await expect(users.createUserByAdmin({ fullName: 'Denied', phoneNumber: '0999111103', password: 'ManagementTest@2026', role: Role.ADMIN })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(users.adminUpdateUser(targetId, { role: Role.ADMIN })).rejects.toBeInstanceOf(ForbiddenException);
    expectNoWrites();
  });

  it('canonicalizes UUID casing before denying self unlock', async () => {
    await expect(users.unlockUser(actorId, actorId.toUpperCase(), 'Test reason')).rejects.toBeInstanceOf(ForbiddenException);
    expect(lockout.withUsersLock).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('UsersController forwards server actor to create/update independently of body claims', async () => {
    const mockedUsers = {
      createUserByAdmin: vi.fn(async () => target),
      adminUpdateUser: vi.fn(async () => target),
      deleteUser: vi.fn(async () => ({ message: 'ok' })),
    };
    const controller = new UsersController(mockedUsers as any);
    const dto = { fullName: 'Test', phoneNumber: '0999111103', password: 'ManagementTest@2026', role: Role.FARMER, actorId: targetId } as any;
    const patch = { fullName: 'Test edit', actorId: targetId, userId: targetId } as any;
    await controller.createUser(dto, actorId);
    await controller.adminUpdateUser(targetId, patch, actorId);
    await controller.deleteUser(targetId, actorId);
    expect(mockedUsers.createUserByAdmin).toHaveBeenCalledWith(dto, actorId);
    expect(mockedUsers.adminUpdateUser).toHaveBeenCalledWith(targetId, patch, actorId);
    expect(mockedUsers.deleteUser).toHaveBeenCalledWith(targetId, actorId);
  });

  it('AuthController forwards its server actor to registration', async () => {
    const mockedAuth = { register: vi.fn(async () => ({ userId: targetId })) };
    const controller = new AuthController(mockedAuth as any, {} as any);
    const dto = { fullName: 'Test', phoneNumber: '0999111103', email: 'isolated@example.invalid', role: Role.FARMER, actorId: targetId } as any;
    await controller.register(dto, '127.0.0.1', 'Test Agent', actorId);
    expect(mockedAuth.register).toHaveBeenCalledWith(dto, 'Test Agent', actorId);
  });

  it('AuthService rechecks management authority before registration can create an ADMIN', async () => {
    const authority = vi.spyOn(users, 'assertManagementAuthority');
    const email = { sendInitialPassword: vi.fn() };
    const source = { transaction: vi.fn() };
    const auth = new AuthService(users, {} as any, new ConfigService(), {} as any, source as any, email as any, {} as any);
    await expect(auth.register({ fullName: 'Test', phoneNumber: '0999111103', email: 'isolated@example.invalid', role: Role.ADMIN }, 'Test Agent', actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(authority).toHaveBeenCalledWith(actorId, undefined, Role.ADMIN);
    expect(source.transaction).not.toHaveBeenCalled();
    expect(email.sendInitialPassword).not.toHaveBeenCalled();
    expectNoWrites();
  });
});
