import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class UpdateThresholdConfigDto {
  @IsOptional()
  @IsString({ message: 'Tên chỉ số phải là chuỗi ký tự!' })
  @Length(2, 50, { message: 'Tên chỉ số từ 2 đến 50 ký tự!' })
  metricName?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Giá trị tối thiểu phải là số thực!' })
  minValue?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giá trị tối đa phải là số thực!' })
  maxValue?: number;

  @IsOptional()
  @IsBoolean({ message: 'Trạng thái hoạt động (isActive) phải là boolean!' })
  isActive?: boolean;
}
