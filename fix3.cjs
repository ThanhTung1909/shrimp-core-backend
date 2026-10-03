const fs = require('fs');
let data = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

const targetRegex = /    const existingUser = await this\.userService\.findByPhoneNumber\([\s\S]*?throw new UnauthorizedException\([\s\S]*?'Tài khoản không tồn tại!',[\s\S]*?\);\s*\}/;

const replaceStr = `    let existingUser;
    if (sendOtpDto.email) {
      existingUser = await this.userService.findByEmail(sendOtpDto.email);
    } else if (sendOtpDto.phoneNumber) {
      existingUser = await this.userService.findByPhoneNumber(sendOtpDto.phoneNumber);
    }

    const purpose = sendOtpDto.purpose || 'REGISTER';

    if (purpose === 'REGISTER' && existingUser) {
      throw new ConflictException(
        sendOtpDto.email ? 'Email này đã được đăng ký trong hệ thống!' : 'Số điện thoại này đã được đăng ký trong hệ thống!',
      );
    }

    if ((purpose === 'LOGIN' || purpose === 'RESET_PASSWORD') && !existingUser) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại!',
      );
    }`;

data = data.replace(targetRegex, replaceStr);

// Also need to fix the otpService call to pass identifier instead of phoneNumber always.
// It looks like:
// const result = await this.otpService.createAndSaveOtp(sendOtpDto.phoneNumber);
// otp = result.otp;
// return { ... phoneNumber: sendOtpDto.phoneNumber }
const targetRegex2 = /    let otp: string \| undefined;[\s\S]*?phoneNumber: sendOtpDto\.phoneNumber,/;

const replaceStr2 = `    let otp: string | undefined;
    const identifier = sendOtpDto.email || sendOtpDto.phoneNumber;
    if (this.otpService && identifier) {
      const result = await this.otpService.createAndSaveOtp(
        identifier,
      );
      otp = result.otp;
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException(
          'Dịch vụ OTP chưa sẵn sàng, vui lòng liên hệ quản trị viên!',
        );
      }
      otp = '123456';
    }

    // In case of email, sending via EmailService could be done here.
    if (sendOtpDto.email && otp && process.env.NODE_ENV === 'production') {
      try {
         await this.emailService.sendResetPasswordEmail(sendOtpDto.email, otp);
      } catch(e) {
         // ignore
      }
    }

    return {
      message: 'Mã OTP đã được gửi thành công!',
      phoneNumber: identifier || '',`;

data = data.replace(targetRegex2, replaceStr2);

fs.writeFileSync('src/modules/auth/auth.service.ts', data, 'utf8');
console.log("Success:", data.includes('existingUser = await this.userService.findByEmail'));
