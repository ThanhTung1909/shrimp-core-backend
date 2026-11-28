import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../../common/enums/role.enum.js';
import { FarmsService } from './farms.service.js';

function setup() {
  const farms = { create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => ({ farmId: 'farm', ...value as object })), findOne: vi.fn(), findAndCount: vi.fn(), remove: vi.fn() };
  const ponds = { exist: vi.fn().mockResolvedValue(false), find: vi.fn(), update: vi.fn() };
  const users = { findOneBy: vi.fn() };
  return { service: new FarmsService(farms as never, ponds as never, users as never), farms, ponds, users };
}
describe('FarmsService', () => {
  it('uses the authenticated user as farm owner', async () => {
    const { service } = setup();
    const farm = await service.create({ farmName: 'Trại A', totalArea: 1200 }, 'owner');
    expect(farm.ownerId).toBe('owner');
    expect(farm.totalArea).toBe('1200');
  });
  it('blocks a farmer from another owner farm', async () => {
    const { service, farms } = setup();
    farms.findOne.mockResolvedValue({ farmId: 'farm', ownerId: 'owner' });
    await expect(service.findOne('farm', 'other', Role.FARMER)).rejects.toThrow(ForbiddenException);
  });
  it('does not delete a farm that still contains ponds', async () => {
    const { service, farms, ponds } = setup();
    farms.findOne.mockResolvedValue({ farmId: 'farm', ownerId: 'owner' });
    ponds.exist.mockResolvedValue(true);
    await expect(service.remove('farm', 'owner', Role.FARMER)).rejects.toThrow(ConflictException);
  });
  it('allows ADMIN to manage a farm owned by another manager', async () => {
    const { service, farms } = setup();
    farms.findOne.mockResolvedValue({ farmId: 'farm', ownerId: 'manager-owner', farmName: 'Foreign farm' });
    await expect(service.findOne('farm', 'admin', Role.ADMIN)).resolves.toMatchObject({ farmId: 'farm' });
    await expect(service.update('farm', { farmName: 'Updated by admin' }, 'admin', Role.ADMIN))
      .resolves.toMatchObject({ farmName: 'Updated by admin' });
    await expect(service.remove('farm', 'admin', Role.ADMIN)).resolves.toEqual({ message: 'Xóa trại nuôi thành công!' });
    expect(farms.remove).toHaveBeenCalled();
  });
  it('allows ADMIN to revoke a manager while retaining the farm', async () => {
    const { service, farms, ponds } = setup();
    farms.findOne.mockResolvedValue({ farmId: 'farm', ownerId: 'manager-owner', farmName: 'Farm A' });
    farms.save.mockImplementation(async (farm: any) => farm);
    await expect(service.revokeManager('farm', 'admin-id', Role.ADMIN))
      .resolves.toMatchObject({ farmId: 'farm', ownerId: null });
    expect(ponds.update).toHaveBeenCalledWith({ farmId: 'farm' }, { userId: 'admin-id' });
  });

  it('strips all 5 sensitive user fields from farm owner, pond owner, and assigned farmers', async () => {
    const { service, farms, ponds } = setup();
    const sensitiveFields = {
      passwordHash: 'secret-hash',
      fcmToken: 'secret-fcm',
      tokenVersion: 4,
      isLocked: true,
      mustChangePassword: true,
    };
    const farmWithUsers = {
      farmId: 'farm-1',
      ownerId: 'manager-1',
      owner: {
        userId: 'manager-1',
        fullName: 'Manager One',
        ...sensitiveFields,
      },
      ponds: [
        {
          pondId: 'pond-1',
          user: {
            userId: 'manager-1',
            fullName: 'Manager One',
            ...sensitiveFields,
          },
          farmerAssignments: [
            {
              assignmentId: 'assign-1',
              farmer: {
                userId: 'farmer-1',
                fullName: 'Farmer One',
                ...sensitiveFields,
              },
            },
          ],
        },
      ],
    };
    farms.findOne.mockResolvedValue(farmWithUsers);
    farms.findAndCount.mockResolvedValue([[farmWithUsers], 1]);
    ponds.find.mockResolvedValue(farmWithUsers.ponds);

    const expectSanitized = (userObj: any) => {
      expect(userObj).toBeDefined();
      expect(userObj).not.toHaveProperty('passwordHash');
      expect(userObj).not.toHaveProperty('fcmToken');
      expect(userObj).not.toHaveProperty('tokenVersion');
      expect(userObj).not.toHaveProperty('isLocked');
      expect(userObj).not.toHaveProperty('mustChangePassword');
    };

    const one = await service.findOne('farm-1', 'admin-id', Role.ADMIN);
    expectSanitized(one.owner);
    expectSanitized(one.ponds[0].user);
    expectSanitized(one.ponds[0].farmerAssignments[0].farmer);

    const list = await service.findAll({}, 'admin-id', Role.ADMIN);
    expectSanitized(list.data[0].owner);
    expectSanitized(list.data[0].ponds[0].farmerAssignments[0].farmer);

    const farmPonds = await service.findPonds('farm-1', 'admin-id', Role.ADMIN);
    expectSanitized(farmPonds[0].user);
    expectSanitized(farmPonds[0].farmerAssignments[0].farmer);
  });
});
