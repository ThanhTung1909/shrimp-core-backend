import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../../common/enums/role.enum.js';
import { FarmsService } from './farms.service.js';

function setup() {
  const farms = { create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => ({ farmId: 'farm', ...value as object })), findOne: vi.fn(), findAndCount: vi.fn(), remove: vi.fn() };
  const ponds = { exist: vi.fn().mockResolvedValue(false), find: vi.fn() };
  return { service: new FarmsService(farms as never, ponds as never), farms, ponds };
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
});
