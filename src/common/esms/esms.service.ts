import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

@Injectable()
export class EsmsService {
  private readonly logger = new Logger(EsmsService.name);
  private readonly apiUrl = 'http://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/';

  constructor(private readonly configService: ConfigService) {}

  /**
   * Gọi API eSMS qua phương thức POST (SmsType=2, Brandname)
   * @param phone Số điện thoại người nhận
   * @param otp Mã OTP cần gửi
   */
  async sendSMS(phone: string, otp: string): Promise<any> {
    const mode = (
      this.configService.get<string>('SMS_MODE') || 'esms'
    ).trim().toLowerCase();
    const nodeEnv = (
      this.configService.get<string>('NODE_ENV') ||
      process.env.NODE_ENV ||
      'development'
    ).trim().toLowerCase();

    // Chuẩn hóa số điện thoại: giữ nguyên định dạng số, bỏ các ký tự lạ
    const normalizedPhone = phone.replace(/\D/g, '');

    if (mode === 'mock') {
      if (nodeEnv !== 'development' && nodeEnv !== 'test') {
        this.logger.error(
          `SMS_MODE=mock bị từ chối trong NODE_ENV=${nodeEnv}`,
        );
        throw new InternalServerErrorException(
          'SMS mock chỉ được phép trong môi trường development hoặc test',
        );
      }

      // OTP vẫn do OtpService sinh ngẫu nhiên và lưu hash trong Redis.
      // AuthService chỉ có thể in OTP vào console ở local development khi fallback được bật rõ ràng.
      this.logger.warn('SMS mock transport accepted a delivery request');
      return {
        CodeResult: '100',
        ErrorMessage: '',
        SMSID: `mock-${randomUUID()}`,
        IsMock: true,
      };
    }

    if (mode !== 'esms') {
      this.logger.error(`SMS_MODE không hợp lệ: ${mode}`);
      throw new InternalServerErrorException('Lỗi cấu hình SMS Gateway');
    }

    const apiKey = this.configService.get<string>('ESMS_API_KEY');
    const secretKey = this.configService.get<string>('ESMS_SECRET_KEY');

    if (!apiKey || !secretKey) {
      this.logger.error('Thiếu cấu hình ESMS_API_KEY hoặc ESMS_SECRET_KEY');
      throw new InternalServerErrorException('Lỗi cấu hình SMS Gateway');
    }

    const brandname = this.configService.get<string>('ESMS_BRANDNAME') || 'Baotrixemay';
    const template = this.configService.get<string>('ESMS_CONTENT_TEMPLATE') || '{OTP} la ma xac minh dang ky Baotrixemay cua ban';

    // Nội dung chuẩn theo cấu hình
    const content = template
      .replace('{OTP}', otp)
      .replace('{BRANDNAME}', brandname);

    const payload = {
      ApiKey: apiKey,
      SecretKey: secretKey,
      Phone: normalizedPhone,
      Content: content,
      Brandname: brandname,
      SmsType: '2',
      IsUnicode: '0',
    };

    // Không log payload/content vì Content chứa OTP.
    this.logger.debug('Sending SMS request to eSMS');

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();

      // Kiểm tra nếu response trả về XML/HTML lỗi
      if (text.trim().startsWith('<')) {
        this.logger.error('eSMS returned an invalid XML/HTML response');
        throw new InternalServerErrorException('eSMS Gateway trả về định dạng không hợp lệ (XML/HTML).');
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        this.logger.error('Failed to parse eSMS JSON response');
        throw new InternalServerErrorException('Không thể phân tích phản hồi từ eSMS Gateway.');
      }

      this.logger.debug('Received eSMS response');

      if (data.CodeResult !== '100') {
        const errorMsg = `eSMS rejected the request (code ${data.CodeResult})`;
        this.logger.error(errorMsg);
        throw new InternalServerErrorException(errorMsg);
      }

      this.logger.log('eSMS accepted the delivery request');
      return data;
    } catch {
      this.logger.error('Unable to send SMS through eSMS');
      throw new InternalServerErrorException(
        'Không thể kết nối đến hệ thống gửi SMS',
      );
    }
  }
}
