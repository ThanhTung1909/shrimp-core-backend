import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../src/common/enums/role.enum.js';
import { CropsService } from '../src/modules/crops/crops.service.js';
import { PondsService } from '../src/modules/ponds/ponds.service.js';

const managerId = '11111111-1111-4111-8111-111111111111';
const farmerId = '22222222-2222-4222-8222-222222222222';
const otherManagerId = '33333333-3333-4333-833333333333';
const pond = { pondId: '44444444-4444-4444-8444-444444444444', userId: managerId };

describe('P1-3 manager/farmer pond assignment authorization', () => {
  function pondsService(assigned = false) {
    const pondRepo = { findOne: vi.fn().mockResolvedValue(pond) };
    const assignments = {
      exist: vi.fn().mockResolvedValue(assigned),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
      findOneBy: vi.fn(),
      remove: vi.fn(),
    };
    const users = { findOneBy: vi.fn().mockResolvedValue({ userId: farmerId, role: Role.FARMER }) };
    const service = new PondsService(pondRepo as never, {} as never, {} as never,
      {} as never, users as never, assignments as never);
    return { service, assignments };
  }

  it('allows an assigned FARMER to read a pond and rejects an unassigned FARMER', async () => {
    const assigned = pondsService(true);
    await expect(assigned.service.findPondById(pond.pondId, farmerId, Role.FARMER)).resolves.toEqual(pond);

    const unassigned = pondsService(false);
    await expect(unassigned.service.findPondById(pond.pondId, farmerId, Role.FARMER)).rejects.toThrow(ForbiddenException);
  });

  it('allows only the owning MANAGER to assign a FARMER', async () => {
    const { service, assignments } = pondsService(false);
    await expect(service.assignFarmer(pond.pondId, farmerId, managerId, Role.MANAGER))
      .resolves.toMatchObject({ pondId: pond.pondId, farmerId });
    expect(assignments.save).toHaveBeenCalled();

    await expect(service.assignFarmer(pond.pondId, farmerId, otherManagerId, Role.MANAGER))
      .rejects.toThrow(ForbiddenException);
  });

  it('prevents FARMER from creating or editing a crop even when assigned', async () => {
    const assignments = { exist: vi.fn().mockResolvedValue(true) };
    const batches = { findOne: vi.fn().mockResolvedValue({ batchId: 'batch', pond, status: 'ACTIVE' }) };
    const service = new CropsService(batches as never, {} as never,
      { findOneBy: vi.fn().mockResolvedValue(pond) } as never, assignments as never);

    await expect(service.create({ pondId: pond.pondId, stockingDate: '2026-01-01', initialQuantity: 10, shrimpSpecies: 'Vannamei' }, farmerId, Role.FARMER))
      .rejects.toThrow(ForbiddenException);
    await expect(service.update('batch', { shrimpSpecies: 'Changed' }, farmerId, Role.FARMER))
      .rejects.toThrow(ForbiddenException);
  });
});
