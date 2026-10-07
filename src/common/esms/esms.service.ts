import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
    const apiKey = this.configService.get<string>('ESMS_API_KEY');
    const secretKey = this.configService.get<string>('ESMS_SECRET_KEY');

    if (!apiKey || !secretKey) {
      this.logger.error('Thiếu cấu hình ESMS_API_KEY hoặc ESMS_SECRET_KEY');
      throw new InternalServerErrorException('Lỗi cấu hình SMS Gateway');
    }

    const brandname = this.configService.get<string>('ESMS_BRANDNAME') || 'Baotrixemay';
    const template = this.configService.get<string>('ESMS_CONTENT_TEMPLATE') || '{OTP} la ma xac minh dang ky Baotrixemay cua ban';

    // Chuẩn hóa số điện thoại: giữ nguyên định dạng số, bỏ các ký tự lạ
    const normalizedPhone = phone.replace(/\D/g, '');

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

    // Do not log the request payload: Content contains the plaintext OTP.
    this.logger.debug(`Sending SMS to eSMS for phone ${normalizedPhone}`);

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
        this.logger.error('eSMS returned an XML/HTML error response.');
        throw new InternalServerErrorException('eSMS Gateway trả về định dạng không hợp lệ (XML/HTML).');
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        this.logger.error('Failed to parse eSMS JSON response.');
        throw new InternalServerErrorException('Không thể phân tích phản hồi từ eSMS Gateway.');
      }

      this.logger.debug(
        `Response from eSMS: code=${data.CodeResult}, refId=${data.SMSID ?? 'n/a'}`,
      );

      if (data.CodeResult !== '100') {
        const errorMsg = `eSMS Error [Code ${data.CodeResult}]: ${data.ErrorMessage}`;
        this.logger.error(`eSMS provider rejected the request: code=${data.CodeResult}`);
        throw new InternalServerErrorException(errorMsg);
      }

      this.logger.log(
        `Gửi SMS thành công tới ${normalizedPhone}, RefId: ${data.SMSID}`,
      );
      return data;
    } catch (error: any) {
      this.logger.error('Lỗi kết nối hoặc xử lý eSMS.');
      throw new InternalServerErrorException(
        error.message || 'Không thể kết nối đến hệ thống gửi SMS',
      );
    }
  }
}
