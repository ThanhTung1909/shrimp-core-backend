import { IsNotEmpty, IsOptional, IsString, Length, MinLength } from 'class-validator';

export class ChangePasswordDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    currentPassword: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    newPassword: string;

    @IsString({ message: 'Mã OTP phải là chuỗi ký tự!' })
    @IsNotEmpty({ message: 'Mã OTP không được để trống!' })
    @Length(6, 6, { message: 'Mã OTP phải bao gồm đúng 6 chữ số!' })
    otp: string;

    @IsOptional()
    @IsString()
    refreshToken?: string;
}