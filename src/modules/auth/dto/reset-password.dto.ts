import { IsEmail, IsNotEmpty, IsString, MinLength, ValidateIf, Matches } from 'class-validator';

export class ResetPasswordDto {
  @ValidateIf(o => !o.email)
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống!' })
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Số điện thoại không hợp lệ (phải gồm 10-11 chữ số)!',
  })
  phoneNumber?: string;

  @ValidateIf(o => !o.phoneNumber)
  @IsNotEmpty({ message: 'Email không được để trống!' })
  @IsEmail({}, { message: 'Email không hợp lệ!' })
  email?: string;

  @IsString({ message: 'Mã OTP phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Mã OTP không được để trống!' })
  otp: string;

  @IsString({ message: 'Mật khẩu mới phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống!' })
  @MinLength(8, { message: 'Mật khẩu mới phải có ít nhất 8 ký tự!' })
  newPassword: string;
}
