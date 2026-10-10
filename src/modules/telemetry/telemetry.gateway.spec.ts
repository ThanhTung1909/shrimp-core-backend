import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryGateway } from './telemetry.gateway.js';
import { Role } from '../../common/enums/role.enum.js';
import { ForbiddenException } from '@nestjs/common';

describe('TelemetryGateway', () => {
  let gateway: TelemetryGateway;
  let mockJwtService: any;
  let mockConfigService: any;
  let mockRedisService: any;
  let mockPondsService: any;
  let mockServer: any;

  beforeEach(() => {
    mockJwtService = {
      verifyAsync: vi.fn(),
    };

    mockConfigService = {
      get: vi.fn((key) => {
        if (key === 'JWT_ACCESS_SECRET') return 'test-jwt-secret';
        return null;
      }),
    };

    mockRedisService = {
      getClient: vi.fn().mockReturnValue({
        duplicate: vi.fn().mockReturnValue({
          subscribe: vi.fn(),
          on: vi.fn(),
          quit: vi.fn().mockResolvedValue('OK'),
        }),
      }),
    };

    mockPondsService = {
      findPondById: vi.fn(),
    };

    mockServer = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };

    gateway = new TelemetryGateway(
      mockJwtService,
      mockConfigService,
      mockRedisService,
      mockPondsService,
    );
    gateway.server = mockServer as any;
  });

  describe('handleConnection', () => {
    it('nên từ chối kết nối và disconnect khi không có JWT token', async () => {
      const mockClient: any = {
        id: 'socket-1',
        handshake: { headers: {}, auth: {}, query: {} },
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        message: expect.stringContaining('Xác thực thất bại'),
      }));
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('nên ngắt kết nối khi JWT token không hợp lệ hoặc hết hạn', async () => {
      const mockClient: any = {
        id: 'socket-2',
        handshake: {
          auth: { token: 'invalid-token' },
          headers: {},
          query: {},
        },
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      mockJwtService.verifyAsync.mockRejectedValue(new Error('Token expired'));

      await gateway.handleConnection(mockClient);

      expect(mockClient.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        message: expect.stringContaining('Token không hợp lệ'),
      }));
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('nên xác thực thành công và tự động cho client join vào room user:<userId>', async () => {
      const mockClient: any = {
        id: 'socket-3',
        handshake: {
          auth: { token: 'valid-bearer-token' },
          headers: {},
          query: {},
        },
        data: {},
        join: vi.fn().mockResolvedValue(undefined),
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      const mockPayload = {
        sub: 'user-uuid-123',
        role: Role.FARMER,
        type: 'access',
      };

      mockJwtService.verifyAsync.mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockClient);

      expect(mockClient.data.user).toEqual(mockPayload);
      expect(mockClient.data.userId).toBe('user-uuid-123');
      expect(mockClient.join).toHaveBeenCalledWith('user:user-uuid-123');
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('handleSubscribePond', () => {
    it('nên trả về lỗi khi truyền thiếu pondId', async () => {
      const mockClient: any = { id: 's1', data: { user: { sub: 'u1', role: Role.FARMER } } };

      const result = await gateway.handleSubscribePond(mockClient, { pondId: '' });

      expect(result).toEqual({ status: 'error', message: 'Truyền thiếu pondId' });
    });

    it('nên cho phép Farmer join room pond:<pondId> khi Farmer có quyền đối với đầm tôm', async () => {
      const mockClient: any = {
        id: 's2',
        data: { user: { sub: 'farmer-1', role: Role.FARMER } },
        join: vi.fn().mockResolvedValue(undefined),
      };

      mockPondsService.findPondById.mockResolvedValue({ pondId: 'pond-100', userId: 'farmer-1' });

      const result = await gateway.handleSubscribePond(mockClient, { pondId: 'pond-100' });

      expect(mockPondsService.findPondById).toHaveBeenCalledWith('pond-100', 'farmer-1', Role.FARMER);
      expect(mockClient.join).toHaveBeenCalledWith('pond:pond-100');
      expect(result.status).toBe('success');
      expect(result.room).toBe('pond:pond-100');
    });

    it('nên từ chối cho Farmer join room đầm tôm nếu đầm tôm thuộc về người khác (Forbidden)', async () => {
      const mockClient: any = {
        id: 's3',
        data: { user: { sub: 'farmer-2', role: Role.FARMER } },
        join: vi.fn(),
      };

      mockPondsService.findPondById.mockRejectedValue(
        new ForbiddenException('Bạn không có quyền truy cập ao nuôi này!'),
      );

      const result = await gateway.handleSubscribePond(mockClient, { pondId: 'pond-200' });

      expect(mockClient.join).not.toHaveBeenCalled();
      expect(result.status).toBe('error');
      expect(result.message).toContain('không có quyền');
    });
  });

  describe('handleUnsubscribePond', () => {
    it('nền cho phép client rời khỏi room đầm tôm', async () => {
      const mockClient: any = {
        id: 's4',
        leave: vi.fn().mockResolvedValue(undefined),
      };

      const result = await gateway.handleUnsubscribePond(mockClient, { pondId: 'pond-100' });

      expect(mockClient.leave).toHaveBeenCalledWith('pond:pond-100');
      expect(result.status).toBe('success');
    });
  });

  describe('Broadcasting', () => {
    it('nên phát sự kiện telemetry:new tới room pond:<pondId> và user:<userId>', () => {
      gateway.broadcastTelemetry({
        pondId: 'pond-1',
        userId: 'user-1',
        data: { temp: 28.5 },
      });

      expect(mockServer.to).toHaveBeenCalledWith('pond:pond-1');
      expect(mockServer.to).toHaveBeenCalledWith('user:user-1');
      expect(mockServer.emit).toHaveBeenCalledWith('telemetry:new', { temp: 28.5 });
    });

    it('nên phát sự kiện alert:triggered tới room pond:<pondId> và user:<userId>', () => {
      gateway.broadcastAlert({
        pondId: 'pond-1',
        userId: 'user-1',
        alert: { id: 'a1', message: 'Alert' },
      });

      expect(mockServer.to).toHaveBeenCalledWith('pond:pond-1');
      expect(mockServer.to).toHaveBeenCalledWith('user:user-1');
      expect(mockServer.emit).toHaveBeenCalledWith('alert:triggered', { id: 'a1', message: 'Alert' });
    });
  });
});
