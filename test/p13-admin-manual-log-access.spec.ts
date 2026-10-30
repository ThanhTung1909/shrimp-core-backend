import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../src/common/enums/role.enum.js';
import { PondsService } from '../src/modules/ponds/ponds.service.js';

const adminId = '00000000-0000-4000-8000-000000000001';
const managerId = '11111111-1111-4111-8111-111111111111';
const otherManagerId = '33333333-3333-4333-8333-333333333333';
const farmerId = '22222222-2222-4222-8222-222222222222';
const pond = { pondId: '44444444-4444-4444-8444-444444444444', userId: managerId };
const log = { logId: '55555555-5555-4555-8555-555555555555', pond, pondId: pond.pondId, note: 'initial' };

function setup(assigned = true) {
  const assignmentRepo = {
    exist: vi.fn().mockImplementation(async () => assigned),
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
    findOneBy: vi.fn().mockResolvedValue({ pondId: pond.pondId, farmerId }),
    remove: vi.fn(async () => undefined),
  };
  const manualLogRepo = {
    findOne: vi.fn().mockResolvedValue({ ...log }),
    save: vi.fn(async (value) => value),
    remove: vi.fn(async () => undefined),
  };
  const service = new PondsService(
    { findOne: vi.fn().mockResolvedValue(pond) } as never,
    {} as never,
    manualLogRepo as never,
    {} as never,
    { findOneBy: vi.fn().mockResolvedValue({ userId: farmerId, role: Role.FARMER }) } as never,
    assignmentRepo as never,
  );
  return { service, assignmentRepo, manualLogRepo, setAssigned: (value: boolean) => { assigned = value; } };
}

describe('P1-3 ADMIN assignment and Manual Log authorization', () => {
  it('allows ADMIN to create, update, and delete a pond owned by another manager', async () => {
    const pondRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
      remove: vi.fn(async () => undefined),
    };
    const service = new PondsService(
      pondRepo as never, {} as never, {} as never, { findOneBy: vi.fn() } as never,
      {} as never, { exist: vi.fn().mockResolvedValue(false) } as never,
    );
    await expect(service.createPond({ pondName: 'Admin pond', areaM2: 100, depthM: 1, shrimpDensity: 20 }, adminId, Role.ADMIN))
      .resolves.toMatchObject({ userId: adminId });

    const foreignPond = { ...pond, pondName: 'Foreign pond' };
    pondRepo.findOne.mockResolvedValue(foreignPond);
    await expect(service.updatePond(pond.pondId, { status: 'ACTIVE' as never }, adminId, Role.ADMIN))
      .resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(service.deletePond(pond.pondId, adminId, Role.ADMIN))
      .resolves.toEqual({ message: 'Xóa ao nuôi thành công!' });
  });

  it('allows ADMIN to assign and revoke a FARMER on another manager pond', async () => {
    const { service, assignmentRepo } = setup(false);

    await expect(service.assignFarmer(pond.pondId, farmerId, adminId, Role.ADMIN))
      .resolves.toMatchObject({ pondId: pond.pondId, farmerId });
    await expect(service.revokeFarmer(pond.pondId, farmerId, adminId, Role.ADMIN))
      .resolves.toEqual({ message: 'Thu hồi phân công FARMER thành công!' });
    expect(assignmentRepo.save).toHaveBeenCalled();
    expect(assignmentRepo.remove).toHaveBeenCalled();
  });

  it('prevents a non-owning MANAGER from assigning a FARMER', async () => {
    const { service } = setup();
    await expect(service.assignFarmer(pond.pondId, farmerId, otherManagerId, Role.MANAGER))
      .rejects.toThrow(ForbiddenException);
  });

  it('allows ADMIN and the owning MANAGER to read, update, and delete a manual log', async () => {
    const { service, manualLogRepo } = setup();
    await expect(service.findManualLogById(log.logId, adminId, Role.ADMIN)).resolves.toMatchObject({ logId: log.logId });
    await expect(service.updateManualTestLog(log.logId, { note: 'admin edit' }, adminId, Role.ADMIN)).resolves.toMatchObject({ note: 'admin edit' });
    await expect(service.deleteManualTestLog(log.logId, managerId, Role.MANAGER)).resolves.toEqual({ message: 'Xóa bản ghi đo thủ công thành công!' });
    expect(manualLogRepo.remove).toHaveBeenCalled();
  });

  it('prevents a non-owning MANAGER from reading, updating, or deleting a manual log', async () => {
    const { service } = setup();
    await expect(service.findManualLogById(log.logId, otherManagerId, Role.MANAGER)).rejects.toThrow(ForbiddenException);
    await expect(service.updateManualTestLog(log.logId, { note: 'tamper' }, otherManagerId, Role.MANAGER)).rejects.toThrow(ForbiddenException);
    await expect(service.deleteManualTestLog(log.logId, otherManagerId, Role.MANAGER)).rejects.toThrow(ForbiddenException);
  });

  it('lets an assigned FARMER read a manual log, but keeps updates and deletion manager-only', async () => {
    const { service } = setup(true);
    await expect(service.findManualLogById(log.logId, farmerId, Role.FARMER)).resolves.toMatchObject({ logId: log.logId });
    await expect(service.updateManualTestLog(log.logId, { note: 'edit' }, farmerId, Role.FARMER)).rejects.toThrow(ForbiddenException);
    await expect(service.deleteManualTestLog(log.logId, farmerId, Role.FARMER)).rejects.toThrow(ForbiddenException);
  });

  it('immediately blocks a revoked FARMER from GET, PATCH, and DELETE', async () => {
    const { service, setAssigned } = setup(true);
    setAssigned(false);
    await expect(service.findManualLogById(log.logId, farmerId, Role.FARMER)).rejects.toThrow(ForbiddenException);
    await expect(service.updateManualTestLog(log.logId, { note: 'edit' }, farmerId, Role.FARMER)).rejects.toThrow(ForbiddenException);
    await expect(service.deleteManualTestLog(log.logId, farmerId, Role.FARMER)).rejects.toThrow(ForbiddenException);
  });
});
