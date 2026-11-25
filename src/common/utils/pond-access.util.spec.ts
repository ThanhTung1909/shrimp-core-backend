import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../enums/role.enum.js';
import { Pond } from '../../modules/ponds/entities/pond.entity.js';
import { assertPondAccess, assertPondManager } from './pond-access.util.js';

const basePond = {
  pondId: 'pond-1',
  userId: 'owner-1',
  farmId: 'farm-1',
} as Pond;

describe('pond-access.util', () => {
  describe('assertPondAccess', () => {
    it('always allows ADMIN', async () => {
      await expect(
        assertPondAccess(basePond, 'admin-1', Role.ADMIN, {
          farmRepo: { findOneBy: vi.fn() },
          assignmentRepo: { exist: vi.fn() },
        }),
      ).resolves.toBeUndefined();
    });

    it('allows MANAGER who owns the pond or its farm, and rejects non-owning MANAGER when farmRepo is provided', async () => {
      const farmRepo = {
        findOneBy: vi.fn().mockResolvedValue({ farmId: 'farm-1', ownerId: 'manager-2' }),
      };

      await expect(
        assertPondAccess(basePond, 'owner-1', Role.MANAGER, { farmRepo }),
      ).resolves.toBeUndefined();

      await expect(
        assertPondAccess(basePond, 'manager-2', Role.MANAGER, { farmRepo }),
      ).resolves.toBeUndefined();

      await expect(
        assertPondAccess(basePond, 'manager-other', Role.MANAGER, { farmRepo }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('checks assignmentRepo for FARMER when available and falls back to pond.userId otherwise', async () => {
      const assignedRepo = { exist: vi.fn().mockResolvedValue(true) };
      const unassignedRepo = { exist: vi.fn().mockResolvedValue(false) };

      await expect(
        assertPondAccess(basePond, 'farmer-1', Role.FARMER, {
          assignmentRepo: assignedRepo,
        }),
      ).resolves.toBeUndefined();
      expect(assignedRepo.exist).toHaveBeenCalledWith({
        where: { pondId: 'pond-1', farmerId: 'farmer-1' },
      });

      await expect(
        assertPondAccess(basePond, 'farmer-1', Role.FARMER, {
          assignmentRepo: unassignedRepo,
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        assertPondAccess(basePond, 'owner-1', Role.FARMER),
      ).resolves.toBeUndefined();

      await expect(
        assertPondAccess(basePond, 'other-farmer', Role.FARMER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assertPondManager', () => {
    it('always allows ADMIN', async () => {
      await expect(
        assertPondManager(basePond, 'admin-1', Role.ADMIN, {
          farmRepo: { findOneBy: vi.fn() },
          assignmentRepo: { exist: vi.fn() },
        }),
      ).resolves.toBeUndefined();
    });

    it('allows only farm-owning MANAGER when farmRepo is provided', async () => {
      const farmRepo = {
        findOneBy: vi.fn().mockResolvedValue({ farmId: 'farm-1', ownerId: 'manager-1' }),
      };

      await expect(
        assertPondManager(basePond, 'manager-1', Role.MANAGER, { farmRepo }),
      ).resolves.toBeUndefined();

      await expect(
        assertPondManager(basePond, 'manager-other', Role.MANAGER, { farmRepo }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        assertPondManager(basePond, 'farmer-1', Role.FARMER, { farmRepo }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('supports custom managerForbiddenMessage when FARMER or non-owner is rejected', async () => {
      const customMessage = 'Chỉ MANAGER sở hữu ao mới có quyền quản lý vụ nuôi!';

      await expect(
        assertPondManager(
          basePond,
          'farmer-1',
          Role.FARMER,
          { assignmentRepo: { exist: vi.fn() } },
          customMessage,
        ),
      ).rejects.toThrow(customMessage);
    });
  });
});
