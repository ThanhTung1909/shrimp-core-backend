const fs = require('fs');

let serviceCode = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

// Add imports
if (!serviceCode.includes('import { ResetPasswordDto }')) {
  serviceCode = serviceCode.replace(
    /import { VerifyOtpDto } from '\.\/dto\/verify-otp\.dto\.js';/,
    `import { VerifyOtpDto } from './dto/verify-otp.dto.js';\nimport { ResetPasswordDto } from './dto/reset-password.dto.js';`
  );
}

if (!serviceCode.includes('import { LoginSecurityService }')) {
  serviceCode = serviceCode.replace(
    /import { EmailService } from '\.\.\/email\/email\.service\.js';/,
    `import { EmailService } from '../email/email.service.js';\nimport { LoginSecurityService } from '../../common/redis/login-security.service.js';`
  );
}

// Add to constructor
if (!serviceCode.includes('private readonly loginSecurityService?: LoginSecurityService')) {
  serviceCode = serviceCode.replace(
    /private readonly otpService\?: OtpService,/,
    `private readonly otpService?: OtpService,\n    @Optional()\n    private readonly loginSecurityService?: LoginSecurityService,`
  );
}

fs.writeFileSync('src/modules/auth/auth.service.ts', serviceCode, 'utf8');
console.log('Fixed imports and constructor in auth.service.ts');
