import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { RecoveryIdentifierDto } from './recovery-identifier.dto.js';

export class ResetPasswordDto extends RecoveryIdentifierDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Mật khẩu phải dài ít nhất 8 ký tự' })
  newPassword: string;
}
