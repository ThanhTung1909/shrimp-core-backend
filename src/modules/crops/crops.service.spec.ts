import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../../common/enums/role.enum.js';
import { ShrimpBatchStatus } from '../../common/enums/shrimp-batch-status.enum.js';
import { CropsService } from './crops.service.js';

const pond = { pondId: '11111111-1111-4111-8111-111111111111', userId: 'owner', areaM2: 250 };
function serviceWith(overrides: Record<string, unknown> = {}) {
  const batches = { exist: vi.fn().mockResolvedValue(false), create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => value), findOne: vi.fn(), remove: vi.fn() };
  const harvests = { exist: vi.fn().mockResolvedValue(false), create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => value) };
  const ponds = { findOneBy: vi.fn().mockResolvedValue(pond) };
  Object.assign(batches, overrides);
  return { service: new CropsService(batches as never, harvests as never, ponds as never), batches, harvests, ponds };
}
describe('CropsService', () => {
  it('creates an active batch with a valid pond and preserves quantity precisely', async () => {
    const { service, batches } = serviceWith();
    const result = await service.create({ pondId: pond.pondId, stockingDate: '2026-01-01', expectedHarvestDate: '2026-04-01', initialQuantity: 125000, shrimpSpecies: 'Vannamei' }, 'owner', Role.FARMER);
    expect(result.initialQuantity).toBe('125000');
    expect(batches.save).toHaveBeenCalled();
  });
  it('rejects a second active batch before saving', async () => {
    const { service, batches } = serviceWith({ exist: vi.fn().mockResolvedValue(true) });
    await expect(service.create({ pondId: pond.pondId, stockingDate: '2026-01-01', initialQuantity: 1, shrimpSpecies: 'Vannamei' }, 'owner', Role.FARMER)).rejects.toThrow(ConflictException);
    expect(batches.save).not.toHaveBeenCalled();
  });
  it('rejects expected harvest dates before stocking', async () => {
    const { service } = serviceWith();
    await expect(service.create({ pondId: pond.pondId, stockingDate: '2026-04-01', expectedHarvestDate: '2026-01-01', initialQuantity: 1, shrimpSpecies: 'Vannamei' }, 'owner', Role.FARMER)).rejects.toThrow(BadRequestException);
  });
  it('does not disclose a foreign farmer pond', async () => {
    const { service } = serviceWith();
    await expect(service.create({ pondId: pond.pondId, stockingDate: '2026-01-01', initialQuantity: 1, shrimpSpecies: 'Vannamei' }, 'other', Role.FARMER)).rejects.toThrow(ForbiddenException);
  });
  it('calculates initial density from pond area and leaves unknown current density null', async () => {
    const { service, batches } = serviceWith();
    batches.findOne.mockResolvedValue({ batchId: 'batch', pond, initialQuantity: '125000', status: ShrimpBatchStatus.ACTIVE });
    const result = await service.density('batch', 'owner', Role.FARMER);
    expect(result.initialDensity).toBe(500);
    expect(result.currentEstimatedDensity).toBeNull();
  });
  it('cannot reactivate a closed batch', async () => {
    const { service, batches } = serviceWith();
    batches.findOne.mockResolvedValue({ batchId: 'batch', pond, status: ShrimpBatchStatus.HARVESTED });
    await expect(service.changeStatus('batch', ShrimpBatchStatus.ACTIVE, 'owner', Role.FARMER)).rejects.toThrow(ConflictException);
  });
});
