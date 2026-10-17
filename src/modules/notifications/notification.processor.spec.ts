import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationQueueProcessor } from './notification.processor.js';
import { NOTIFICATION_JOBS } from '../../common/queues/queue.constants.js';

describe('NotificationQueueProcessor', () => {
  let processor: NotificationQueueProcessor;
  let mockEmailService: any;
  let mockEsmsService: any;

  beforeEach(() => {
    mockEmailService = {
      sendInitialPassword: vi.fn().mockResolvedValue(undefined),
    };

    mockEsmsService = {
      sendSMS: vi.fn().mockResolvedValue({ CodeResult: '100', SMSID: 'sms-123' }),
    };

    processor = new NotificationQueueProcessor(mockEmailService, mockEsmsService);
  });

  describe('process: send-email', () => {
    it('nên gọi emailService.sendInitialPassword khi nhận job initial-password hợp lệ', async () => {
      const mockJob: any = {
        id: 'job-1',
        name: NOTIFICATION_JOBS.SEND_EMAIL,
        attemptsMade: 0,
        opts: { attempts: 3 },
        data: {
          type: 'initial-password',
          email: 'farmer@shrimp.vn',
          fullName: 'Nguyễn Văn Nông',
          phoneNumber: '0987654321',
          password: 'Password123',
        },
      };

      await processor.process(mockJob);

      expect(mockEmailService.sendInitialPassword).toHaveBeenCalledWith(
        'farmer@shrimp.vn',
        'Nguyễn Văn Nông',
        '0987654321',
        'Password123',
      );
    });

    it('nên ném lỗi khi thiếu thông tin gửi email', async () => {
      const mockJob: any = {
        id: 'job-2',
        name: NOTIFICATION_JOBS.SEND_EMAIL,
        attemptsMade: 0,
        opts: { attempts: 3 },
        data: {
          type: 'initial-password',
          email: '',
        },
      };

      await expect(processor.process(mockJob)).rejects.toThrow('Dữ liệu gửi email mật khẩu ban đầu không đầy đủ');
    });
  });

  describe('process: send-sms', () => {
    it('nên gọi esmsService.sendSMS khi nhận job send-sms hợp lệ', async () => {
      const mockJob: any = {
        id: 'job-3',
        name: NOTIFICATION_JOBS.SEND_SMS,
        attemptsMade: 0,
        opts: { attempts: 3 },
        data: {
          phone: '0912345678',
          otp: '654321',
        },
      };

      const result = await processor.process(mockJob);

      expect(mockEsmsService.sendSMS).toHaveBeenCalledWith('0912345678', '654321');
      expect(result).toEqual({ CodeResult: '100', SMSID: 'sms-123' });
    });

    it('nên ném lỗi khi thiếu số điện thoại hoặc mã OTP', async () => {
      const mockJob: any = {
        id: 'job-4',
        name: NOTIFICATION_JOBS.SEND_SMS,
        attemptsMade: 1,
        opts: { attempts: 3 },
        data: {
          phone: '',
          otp: '',
        },
      };

      await expect(processor.process(mockJob)).rejects.toThrow('Thiếu số điện thoại hoặc mã OTP để gửi SMS');
    });
  });

  describe('process: send-fcm', () => {
    it('nên xử lý gửi push notification thành công', async () => {
      const mockJob: any = {
        id: 'job-5',
        name: NOTIFICATION_JOBS.SEND_FCM,
        attemptsMade: 0,
        opts: { attempts: 3 },
        data: {
          fcmToken: 'fcm-device-token-abc-xyz',
          title: 'Cảnh báo Oxy',
          body: 'Nồng độ Oxy thấp!',
        },
      };

      const result = await processor.process(mockJob);

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          fcmToken: 'fcm-device-token-abc-xyz',
        }),
      );
    });

    it('nên bỏ qua và trả về null khi không có fcmToken', async () => {
      const mockJob: any = {
        id: 'job-6',
        name: NOTIFICATION_JOBS.SEND_FCM,
        attemptsMade: 0,
        opts: { attempts: 3 },
        data: {
          fcmToken: '',
          title: 'Test',
          body: 'Test',
        },
      };

      const result = await processor.process(mockJob);
      expect(result).toBeNull();
    });
  });
});
