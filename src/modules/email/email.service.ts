import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;
  private readonly emailUser?: string;

  constructor(private readonly configService: ConfigService) {
    const host =
      this.configService.get<string>('EMAIL_HOST') || 'smtp.gmail.com';
    const port = parseInt(
      this.configService.get<string>('EMAIL_PORT') || '587',
      10,
    );
    const secure =
      this.configService.get<string>('EMAIL_SECURE') === 'true' || port === 465;
    this.emailUser = this.configService.get<string>('EMAIL_USER');
    const emailPass = this.configService.get<string>('EMAIL_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user: this.emailUser,
        pass: emailPass,
      },
    });
  }

  async sendInitialPassword(
    email: string,
    fullName: string,
    phoneNumber: string,
    password: string,
  ): Promise<void> {
    const subject = 'Tài khoản AquaSense của bạn';
    const text = `Xin chào ${fullName},

Tài khoản AquaSense của bạn đã được tạo thành công.

Thông tin đăng nhập:

Họ tên: ${fullName}
Số điện thoại: ${phoneNumber}
Mật khẩu: ${password}

Vui lòng đăng nhập và đổi mật khẩu sau lần đăng nhập đầu tiên.

Nếu bạn không yêu cầu tạo tài khoản này, vui lòng liên hệ quản trị viên.

Trân trọng,
AquaSense`;

    this.logger.log(`Đang gửi email thông tin tài khoản tới: ${email}`);

    await this.transporter.sendMail({
      from: `"AquaSense" <${this.emailUser || 'no-reply@aquasense.vn'}>`,
      to: email,
      subject,
      text,
    });

    this.logger.log(`Gửi email thông tin tài khoản thành công tới: ${email}`);
  }

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    const result = await this.transporter.sendMail({
      from: `"AquaSense" <${this.emailUser || 'no-reply@aquasense.vn'}>`,
      to: email,
      subject: 'Mã OTP đặt lại mật khẩu AquaSense',
      text: `Mã xác thực đặt lại mật khẩu AquaSense của bạn là: ${otp}\n\nMã có hiệu lực trong 5 phút và chỉ sử dụng một lần. Không chia sẻ mã này với bất kỳ ai.\n\nNếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.`,
    });
    if (!result.accepted?.length || result.rejected?.length) {
      throw new Error('SMTP did not accept the password reset email');
    }
    this.logger.log('SMTP accepted password reset email');
  }

  async sendNotificationEmail(
    email: string,
    subject: string,
    text: string,
  ): Promise<void> {
    this.logger.log(`Đang gửi email thông báo tới: ${email}`);
    await this.transporter.sendMail({
      from: `"AquaSense Alert" <${this.emailUser || 'no-reply@aquasense.vn'}>`,
      to: email,
      subject,
      text,
    });
    this.logger.log(`Gửi email thông báo thành công tới: ${email}`);
  }

  /**
   * Escape HTML special characters to prevent HTML/XSS injection in alert emails.
   */
  escapeHtml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async sendAlertEmail(
    email: string,
    recipientName: string,
    alertDetails: {
      alertId: string;
      pondName?: string;
      pondId?: string;
      metricName: string;
      triggeredValue: number;
      alertLevel: string;
      message?: string;
    },
  ): Promise<void> {
    const safeName = this.escapeHtml(recipientName || 'Quý khách');
    const safePond = this.escapeHtml(alertDetails.pondName || alertDetails.pondId || 'Ao nuôi');
    const safeMetric = this.escapeHtml(alertDetails.metricName);
    const safeValue = alertDetails.triggeredValue;
    const safeLevel = this.escapeHtml(alertDetails.alertLevel);
    const safeMessage = this.escapeHtml(alertDetails.message || '');

    const subject = `[CẢNH BÁO ${safeLevel}] Sự cố tại ${safePond} - AquaSense`;
    const text = `Xin chào ${recipientName},

Hệ thống phát hiện cảnh báo mức độ ${alertDetails.alertLevel} tại ${alertDetails.pondName || alertDetails.pondId || 'ao nuôi'}:
- Chỉ số: ${alertDetails.metricName}
- Giá trị đo: ${alertDetails.triggeredValue}
${alertDetails.message ? `- Chi tiết: ${alertDetails.message}` : ''}

Vui lòng kiểm tra ao nuôi và thực hiện các biện pháp xử lý kịp thời.

Trân trọng,
AquaSense`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #d9534f;">CẢNH BÁO: ${safeLevel}</h2>
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Hệ thống giám sát ao nuôi vừa ghi nhận cảnh báo tại <strong>${safePond}</strong>:</p>
        <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 15px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Mức độ:</td>
            <td style="padding: 8px; border: 1px solid #ddd; color: #d9534f; font-weight: bold;">${safeLevel}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Chỉ số:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${safeMetric}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Giá trị đo:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${safeValue}</td>
          </tr>
          ${safeMessage ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Thông điệp:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${safeMessage}</td>
          </tr>` : ''}
        </table>
        <p>Vui lòng đăng nhập hệ thống để kiểm tra chi tiết và thực hiện xử lý.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777;">Email tự động từ Hệ thống Giám sát & Quản lý Ao nuôi Tôm AquaSense.</p>
      </div>
    `;

    this.logger.log(`Đang gửi alert email (${safeLevel}) tới: ${email}`);

    await this.transporter.sendMail({
      from: `"AquaSense Alert" <${this.emailUser || 'no-reply@aquasense.vn'}>`,
      to: email,
      subject,
      text,
      html,
    });

    this.logger.log(`Gửi alert email thành công tới: ${email}`);
  }
}

