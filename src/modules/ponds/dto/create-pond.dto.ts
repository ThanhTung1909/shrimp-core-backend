import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PondStatus } from '../../../common/enums/pond-status.enum.js';

export class CreatePondDto {
  @IsNotEmpty({ message: 'Tên ao không được để trống!' })
  @IsString({ message: 'Tên ao phải là chuỗi ký tự!' })
  @Length(2, 100, { message: 'Tên ao phải từ 2 đến 100 ký tự!' })
  pondName: string;

  @IsNotEmpty({ message: 'Diện tích ao không được để trống!' })
  @IsNumber({}, { message: 'Diện tích ao phải là số thực!' })
  @IsPositive({ message: 'Diện tích ao phải lớn hơn 0!' })
  areaM2: number;

  @IsNotEmpty({ message: 'Độ sâu mực nước không được để trống!' })
  @IsNumber({}, { message: 'Độ sâu ao phải là số thực!' })
  @IsPositive({ message: 'Độ sâu ao phải lớn hơn 0!' })
  depthM: number;

  @IsNotEmpty({ message: 'Mật độ thả tôm không được để trống!' })
  @IsNumber({}, { message: 'Mật độ tôm phải là số nguyên!' })
  @IsPositive({ message: 'Mật độ tôm phải lớn hơn 0!' })
  shrimpDensity: number;

  @IsOptional()
  @IsEnum(PondStatus, { message: 'Trạng thái ao không hợp lệ!' })
  status?: PondStatus;

  // Dành riêng cho MANAGER nếu muốn tạo ao gán cho người dùng cụ thể
  @IsOptional()
  @IsString({ message: 'userId phải là chuỗi ký tự!' })
  userId?: string;
}
