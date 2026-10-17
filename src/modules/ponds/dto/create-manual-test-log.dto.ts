import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateManualTestLogDto {
  @IsNotEmpty({ message: 'Chỉ số NH3 không được để trống!' })
  @IsNumber({}, { message: 'Chỉ số NH3 phải là số thực!' })
  @Min(0, { message: 'Chỉ số NH3 không được âm!' })
  nh3Value: number;

  @IsNotEmpty({ message: 'Chỉ số NO2 không được để trống!' })
  @IsNumber({}, { message: 'Chỉ số NO2 phải là số thực!' })
  @Min(0, { message: 'Chỉ số NO2 không được âm!' })
  no2Value: number;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi ký tự!' })
  note?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Thời gian đo phải theo định dạng ISO Date!' })
  testedAt?: Date;
}
