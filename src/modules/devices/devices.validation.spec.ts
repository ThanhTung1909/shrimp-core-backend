import { describe, it, expect } from 'vitest';
import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { FindDevicesQueryDto } from './dto/find-devices-query.dto.js';
import { AssignPondDto } from './dto/assign-pond.dto.js';

describe('Devices Validation Suite', () => {
  describe('ParseUUIDPipe Validation (:id)', () => {
    const pipe = new ParseUUIDPipe();

    it('nên chấp nhận UUID hợp lệ', async () => {
      const validUuid = '55555555-5555-5555-5555-555555555555';
      const result = await pipe.transform(validUuid, {
        type: 'param',
        data: 'id',
      });
      expect(result).toBe(validUuid);
    });

    it('nên ném BadRequestException (HTTP 400) khi UUID không hợp lệ', async () => {
      await expect(
        pipe.transform('invalid-uuid-123', {
          type: 'param',
          data: 'id',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('MAC Address Validation', () => {
    describe('CreateDeviceDto', () => {
      const validBasePayload = {
        deviceName: 'Cảm biến pH Ao 1',
        pondId: '33333333-3333-3333-3333-333333333333',
      };

      it('nên pass validation khi MAC đúng định dạng chuẩn', async () => {
        const dto = plainToInstance(CreateDeviceDto, {
          ...validBasePayload,
          macAddress: 'AA:BB:CC:DD:EE:FF',
        });
        const errors = await validate(dto);
        const macErrors = errors.filter((e) => e.property === 'macAddress');
        expect(macErrors).toHaveLength(0);
      });

      it('nên fail validation khi MAC sai định dạng', async () => {
        const dto = plainToInstance(CreateDeviceDto, {
          ...validBasePayload,
          macAddress: 'invalid-mac-address',
        });
        const errors = await validate(dto);
        const macError = errors.find((e) => e.property === 'macAddress');
        expect(macError).toBeDefined();
        expect(macError?.constraints).toHaveProperty('isMacAddress');
        expect(macError?.constraints?.isMacAddress).toBe(
          'Địa chỉ MAC không đúng định dạng!',
        );
      });
    });

    describe('UpdateDeviceDto', () => {
      it('nên pass validation khi cập nhật MAC hợp lệ', async () => {
        const dto = plainToInstance(UpdateDeviceDto, {
          macAddress: '11:22:33:44:55:66',
        });
        const errors = await validate(dto);
        const macErrors = errors.filter((e) => e.property === 'macAddress');
        expect(macErrors).toHaveLength(0);
      });

      it('nên fail validation khi cập nhật MAC không đúng định dạng', async () => {
        const dto = plainToInstance(UpdateDeviceDto, {
          macAddress: '123456',
        });
        const errors = await validate(dto);
        const macError = errors.find((e) => e.property === 'macAddress');
        expect(macError).toBeDefined();
        expect(macError?.constraints?.isMacAddress).toBe(
          'Địa chỉ MAC không đúng định dạng!',
        );
      });

      it('nên pass validation khi không truyền MAC (partial update)', async () => {
        const dto = plainToInstance(UpdateDeviceDto, {
          deviceName: 'Tên thiết bị mới',
        });
        const errors = await validate(dto);
        const macErrors = errors.filter((e) => e.property === 'macAddress');
        expect(macErrors).toHaveLength(0);
      });
    });
  });

  describe('Pagination Limit Validation (@Min / @Max)', () => {
    it('nên pass validation khi limit = 1', async () => {
      const dto = plainToInstance(FindDevicesQueryDto, { limit: 1 });
      const errors = await validate(dto);
      const limitErrors = errors.filter((e) => e.property === 'limit');
      expect(limitErrors).toHaveLength(0);
    });

    it('nên pass validation khi limit = 100', async () => {
      const dto = plainToInstance(FindDevicesQueryDto, { limit: 100 });
      const errors = await validate(dto);
      const limitErrors = errors.filter((e) => e.property === 'limit');
      expect(limitErrors).toHaveLength(0);
    });

    it('nên fail validation khi limit = 101 (> 100)', async () => {
      const dto = plainToInstance(FindDevicesQueryDto, { limit: 101 });
      const errors = await validate(dto);
      const limitError = errors.find((e) => e.property === 'limit');
      expect(limitError).toBeDefined();
      expect(limitError?.constraints).toHaveProperty('max');
      expect(limitError?.constraints?.max).toBe('Mỗi trang tối đa 100 thiết bị!');
    });

    it('nên fail validation khi limit = 0 (< 1)', async () => {
      const dto = plainToInstance(FindDevicesQueryDto, { limit: 0 });
      const errors = await validate(dto);
      const limitError = errors.find((e) => e.property === 'limit');
      expect(limitError).toBeDefined();
      expect(limitError?.constraints).toHaveProperty('min');
    });
  });

  describe('Pond UUID contracts', () => {
    const validV4PondId = '550e8400-e29b-41d4-a716-446655440000';
    const validV1PondId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const invalidSeedPondId = '22222222-2222-2222-2222-222222222203';

    it('accepts a UUID v4 pondId for the /devices query and v4-only device assignment DTOs', async () => {
      const queryErrors = await validate(
        plainToInstance(FindDevicesQueryDto, { pondId: validV4PondId }),
      );
      const createErrors = await validate(
        plainToInstance(CreateDeviceDto, {
          deviceName: 'Cảm biến DO Ao 1',
          macAddress: 'AA:BB:CC:DD:EE:FF',
          pondId: validV4PondId,
        }),
      );
      const assignErrors = await validate(
        plainToInstance(AssignPondDto, { pondId: validV4PondId }),
      );

      expect(queryErrors.filter((error) => error.property === 'pondId')).toHaveLength(0);
      expect(createErrors.filter((error) => error.property === 'pondId')).toHaveLength(0);
      expect(assignErrors.filter((error) => error.property === 'pondId')).toHaveLength(0);
    });

    it('keeps the version-unspecified /devices query distinct from v4-only payload DTOs', async () => {
      const queryErrors = await validate(
        plainToInstance(FindDevicesQueryDto, { pondId: validV1PondId }),
      );
      const createErrors = await validate(
        plainToInstance(CreateDeviceDto, {
          deviceName: 'Cảm biến DO Ao 1',
          macAddress: 'AA:BB:CC:DD:EE:FF',
          pondId: validV1PondId,
        }),
      );

      expect(queryErrors.filter((error) => error.property === 'pondId')).toHaveLength(0);
      expect(createErrors.find((error) => error.property === 'pondId')).toBeDefined();
    });

    it('rejects the malformed seed pondId before the /devices query reaches the service', async () => {
      const errors = await validate(
        plainToInstance(FindDevicesQueryDto, { pondId: invalidSeedPondId }),
      );
      const pondIdError = errors.find((error) => error.property === 'pondId');

      expect(pondIdError).toBeDefined();
      expect(pondIdError?.constraints).toHaveProperty('isUuid');
    });
  });
});
