import {
  IsEnum,
  IsInt,
  Min,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PondStatus } from '../../../common/enums/pond-status.enum.js';

export class CreatePondDto {
  @ApiProperty({ description: 'Tên ao nuôi', example: 'Ao Nuôi Số 1 - Khu A' })
  @IsNotEmpty({ message: 'Tên ao không được để trống!' })
  @IsString({ message: 'Tên ao phải là chuỗi ký tự!' })
  @Length(2, 100, { message: 'Tên ao phải từ 2 đến 100 ký tự!' })
  pondName: string;

  @ApiPropertyOptional({ description: 'Vị trí địa lý/Khu vực ao', example: 'Khu A, Nông trường Bến Tre' })
  @IsOptional()
  @IsString({ message: 'Vị trí ao phải là chuỗi ký tự!' })
  location?: string;

  @ApiPropertyOptional({ description: 'Sức chứa lượng nước (m3)', example: 1500 })
  @IsOptional()
  @IsInt({ message: 'Sức chứa ao phải là số nguyên!' })
  @Min(0, { message: 'Sức chứa ao không được âm!' })
  capacity?: number;

  @ApiProperty({ description: 'Diện tích mặt nước (m2)', example: 1000 })
  @IsNotEmpty({ message: 'Diện tích ao không được để trống!' })
  @IsNumber({}, { message: 'Diện tích ao phải là số thực!' })
  @IsPositive({ message: 'Diện tích ao phải lớn hơn 0!' })
  areaM2: number;

  @ApiProperty({ description: 'Độ sâu mặt nước trung bình (m)', example: 1.5 })
  @IsNotEmpty({ message: 'Độ sâu mực nước không được để trống!' })
  @IsNumber({}, { message: 'Độ sâu ao phải là số thực!' })
  @IsPositive({ message: 'Độ sâu ao phải lớn hơn 0!' })
  depthM: number;

  @ApiProperty({ description: 'Mật độ thả giống (con/m2)', example: 120 })
  @IsNotEmpty({ message: 'Mật độ thả tôm không được để trống!' })
  @IsNumber({}, { message: 'Mật độ tôm phải là số nguyên!' })
  @IsPositive({ message: 'Mật độ tôm phải lớn hơn 0!' })
  shrimpDensity: number;

  @ApiPropertyOptional({ description: 'Trạng thái ao nuôi', enum: PondStatus, example: PondStatus.ACTIVE })
  @IsOptional()
  @IsEnum(PondStatus, { message: 'Trạng thái ao không hợp lệ!' })
  status?: PondStatus;

  @ApiPropertyOptional({ description: 'ID người dùng chủ sở hữu ao (Dành cho Manager)', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsString({ message: 'userId phải là chuỗi ký tự!' })
  userId?: string;
}
