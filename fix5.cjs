const fs = require('fs');
let data = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

// Fix 1: Remove the emailService block
const emailRegex = /\s*\/\/ In case of email[\s\S]*?catch\(e\) \{\s*\/\/ ignore\s*\}\s*\}/;
data = data.replace(emailRegex, '');

// Fix 2: Fix verifyOtp return statement
const returnRegex = /    return \{\s*message: 'Xác thực OTP thành công!',\s*phoneNumber: verifyOtpDto\.phoneNumber,\s*isValid: true,\s*\};/;
const returnReplace = `    return {
      message: 'Xác thực OTP thành công!',
      phoneNumber: identifier || '',
      isValid: true,
    };`;
data = data.replace(returnRegex, returnReplace);

fs.writeFileSync('src/modules/auth/auth.service.ts', data, 'utf8');
