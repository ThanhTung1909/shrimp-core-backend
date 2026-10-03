const fs = require('fs');

let serviceCode = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

const oldLogic = `    const existingUser = sendOtpDto.phoneNumber
      ? await this.userService.findByPhoneNumber(sendOtpDto.phoneNumber)
      : await this.userService.findByEmail(sendOtpDto.email!);
    if (existingUser) {
      throw new ConflictException(
        'S\` \`in thoi nAy \`A \`c \`ng kA trong h th\`ng!',
      );
    }`;

// Since the exact weird characters are hard to match, I will use regex
serviceCode = serviceCode.replace(
  /const existingUser = sendOtpDto\.phoneNumber[\s\S]*?throw new ConflictException\([\s\S]*?\);[\s\S]*?\}/,
  `const existingUser = sendOtpDto.phoneNumber
      ? await this.userService.findByPhoneNumber(sendOtpDto.phoneNumber)
      : await this.userService.findByEmail(sendOtpDto.email!);

    const purpose = sendOtpDto.purpose || 'REGISTER';

    if (purpose === 'REGISTER') {
      if (existingUser) {
        throw new ConflictException('Số điện thoại hoặc email này đã được đăng ký trong hệ thống!');
      }
    } else if (purpose === 'LOGIN' || purpose === 'RESET_PASSWORD') {
      if (!existingUser) {
        throw new UnauthorizedException('Tài khoản không tồn tại trong hệ thống!');
      }
    }`
);

fs.writeFileSync('src/modules/auth/auth.service.ts', serviceCode, 'utf8');
console.log('Fixed purpose logic in auth.service.ts');
