import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { Role } from '../../../common/enums/role.enum.js';
import { Gender } from '../../../common/enums/gender.enum.js';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự!' })
  @Length(2, 100, { message: 'Họ và tên phải từ 2 đến 100 ký tự!' })
  fullName?: string;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Số điện thoại không hợp lệ (phải gồm 10-11 chữ số)!',
  })
  phoneNumber?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email không đúng định dạng!' })
  email?: string;

  @IsOptional()
  @IsEnum(Gender, { message: 'Giới tính không hợp lệ (MALE, FEMALE, OTHER)!' })
  gender?: Gender;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh phải có định dạng YYYY-MM-DD hợp lệ!' })
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'Vai trò (role) không hợp lệ!' })
  role?: Role;

  @IsOptional()
  @IsBoolean({ message: 'Trạng thái hoạt động (isActive) phải là boolean!' })
  isActive?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'mustChangePassword phải là boolean!' })
  mustChangePassword?: boolean;
}

