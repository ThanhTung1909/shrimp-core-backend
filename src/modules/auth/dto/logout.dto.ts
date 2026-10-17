import { IsNotEmpty, IsString } from 'class-validator';

export class LogoutDto {
  @IsString({ message: 'refreshToken phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'refreshToken không được để trống!' })
  refreshToken: string;
}

