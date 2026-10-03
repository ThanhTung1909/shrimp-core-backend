import { IsNotEmpty, IsString, Matches, IsOptional, IsEnum, IsEmail, ValidateIf } from 'class-validator';

export enum OtpPurpose {
  REGISTER = 'REGISTER',
  LOGIN = 'LOGIN',
  RESET_PASSWORD = 'RESET_PASSWORD',
}

export class SendOtpDto {
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

  @IsOptional()
  @IsEnum(OtpPurpose, { message: 'Mục đích không hợp lệ' })
  purpose?: string;
}
