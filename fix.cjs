const fs = require('fs');
let data = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

const targetStr = `    const existingUser = await this.userService.findByPhoneNumber(
      sendOtpDto.phoneNumber,
    );
    if (existingUser) {
      throw new ConflictException(
        'Số điện thoại này đã được đăng ký trong hệ thống!',
      );
    }`;

const replaceStr = `    const existingUser = await this.userService.findByPhoneNumber(
      sendOtpDto.phoneNumber,
    );
    const purpose = sendOtpDto.purpose || 'REGISTER';

    if (purpose === 'REGISTER' && existingUser) {
      throw new ConflictException(
        'Số điện thoại này đã được đăng ký trong hệ thống!',
      );
    }

    if ((purpose === 'LOGIN' || purpose === 'RESET_PASSWORD') && !existingUser) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại!',
      );
    }`;

data = data.replace(targetStr, replaceStr);
fs.writeFileSync('src/modules/auth/auth.service.ts', data, 'utf8');
console.log("Success:", data.includes('Tài khoản không tồn tại!'));
