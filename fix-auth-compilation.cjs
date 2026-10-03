const fs = require('fs');
let code = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

// Fix sendOtp
code = code.replace(
  /async sendOtp\(sendOtpDto: SendOtpDto\): Promise<\{([\s\S]*?)\}> \{/,
  (match) => match.replace('phoneNumber: string;', 'phoneNumber?: string;\n    email?: string;')
);
code = code.replace(
  /const existingUser = await this\.userService\.findByPhoneNumber\([\s\n]*sendOtpDto\.phoneNumber,[\s\n]*\);/,
  `const identifier = sendOtpDto.phoneNumber || sendOtpDto.email;
    if (!identifier) {
      throw new BadRequestException('Vui lòng cung cấp email hoặc số điện thoại!');
    }
    const existingUser = sendOtpDto.phoneNumber
      ? await this.userService.findByPhoneNumber(sendOtpDto.phoneNumber)
      : await this.userService.findByEmail(sendOtpDto.email!);`
);
code = code.replace(
  /const result = await this\.otpService\.createAndSaveOtp\([\s\n]*sendOtpDto\.phoneNumber,[\s\n]*\);/,
  `const result = await this.otpService.createAndSaveOtp(identifier);`
);

// Fix verifyOtp
code = code.replace(
  /async verifyOtp\(verifyOtpDto: VerifyOtpDto\): Promise<\{([\s\S]*?)\}> \{/,
  (match) => match.replace('phoneNumber: string;', 'phoneNumber?: string;\n    email?: string;')
);
code = code.replace(
  /await this\.otpService\.verifyOtp\([\s\n]*verifyOtpDto\.phoneNumber,[\s\n]*verifyOtpDto\.otp,[\s\n]*\);/,
  `const identifier = verifyOtpDto.phoneNumber || verifyOtpDto.email;
      if (!identifier) {
        throw new BadRequestException('Vui lòng cung cấp email hoặc số điện thoại!');
      }
      await this.otpService.verifyOtp(identifier, verifyOtpDto.otp);`
);

fs.writeFileSync('src/modules/auth/auth.service.ts', code, 'utf8');
console.log('Fixed auth.service.ts sendOtp and verifyOtp compilation errors.');
