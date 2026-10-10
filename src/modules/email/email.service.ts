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
}
