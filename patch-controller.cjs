const fs = require('fs');
let data = fs.readFileSync('src/modules/auth/auth.controller.ts', 'utf8');

if (!data.includes('ResetPasswordDto')) {
  data = data.replace(
    "import { LogoutDto } from './dto/logout.dto.js';",
    "import { LogoutDto } from './dto/logout.dto.js';\nimport { ResetPasswordDto } from './dto/reset-password.dto.js';"
  );
}

const controllerCode = `
  @Public()
  @Post('reset-password')
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    // Optionally apply rate limiting here
    return this.authService.resetPassword(resetPasswordDto);
  }
}
`;

data = data.replace(/}\s*$/, controllerCode);
fs.writeFileSync('src/modules/auth/auth.controller.ts', data, 'utf8');
console.log("Controller Updated.");
