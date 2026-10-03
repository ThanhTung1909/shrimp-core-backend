const fs = require('fs');

let code = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

const replacement = `
      if (sendOtpDto.email && otp) {
        try {
          await this.emailService.sendOtpEmail(sendOtpDto.email, otp);
        } catch (error) {
          throw new InternalServerErrorException(
            'Không thể gửi email mã xác thực. Vui lòng thử lại sau!',
          );
        }
      }

      console.log(
        \`[OTP] Gửi thành công; channel=\${sendOtpDto.email ? 'email' : 'phone'}; purpose=\${purpose}; identifier=\${identifier}; otp=\${otp}\`,
      );

      return {`;

code = code.replace(/return \{/, replacement);

fs.writeFileSync('src/modules/auth/auth.service.ts', code, 'utf8');
console.log('Restored email sending and console.log in sendOtp');
