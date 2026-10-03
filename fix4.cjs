const fs = require('fs');
let data = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

const targetRegex = /  async verifyOtp\(verifyOtpDto: VerifyOtpDto\): Promise<\{[\s\S]*?isValid: boolean;\s*\}\> \{\s*if \(this\.otpService\) \{\s*await this\.otpService\.verifyOtp\(\s*verifyOtpDto\.phoneNumber,\s*verifyOtpDto\.otp,\s*\);\s*\} else \{/;

const replaceStr = `  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<{
    message: string;
    phoneNumber: string;
    isValid: boolean;
  }> {
    const identifier = verifyOtpDto.email || verifyOtpDto.phoneNumber;
    if (this.otpService && identifier) {
      await this.otpService.verifyOtp(
        identifier,
        verifyOtpDto.otp,
      );
    } else {`;

data = data.replace(targetRegex, replaceStr);

const targetRegex2 = /    return \{\s*message: 'Mã OTP hợp lệ!',\s*phoneNumber: verifyOtpDto\.phoneNumber,\s*isValid: true,\s*\};/;
const replaceStr2 = `    return {
      message: 'Mã OTP hợp lệ!',
      phoneNumber: identifier || '',
      isValid: true,
    };`;
data = data.replace(targetRegex2, replaceStr2);

fs.writeFileSync('src/modules/auth/auth.service.ts', data, 'utf8');
console.log("Success:", data.includes('const identifier = verifyOtpDto.email || verifyOtpDto.phoneNumber;'));
