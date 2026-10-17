import { IsEnum, IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { OtpPurpose } from '../../../common/redis/otp.constants.js';
import { RecoveryIdentifierDto } from './recovery-identifier.dto.js';

export class VerifyOtpDto extends RecoveryIdentifierDto {
  @IsString({ message: 'Mã OTP phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Mã OTP không được để trống!' })
  @Length(6, 6, { message: 'Mã OTP phải bao gồm đúng 6 chữ số!' })
  @Matches(/^[0-9]{6}$/, { message: 'Mã OTP phải bao gồm đúng 6 chữ số!' })
  otp: string;

  @IsEnum(OtpPurpose, { message: 'Mục đích xác thực OTP không hợp lệ!' })
  @IsNotEmpty({ message: 'Mục đích xác thực OTP không được để trống!' })
  purpose: OtpPurpose;
}
