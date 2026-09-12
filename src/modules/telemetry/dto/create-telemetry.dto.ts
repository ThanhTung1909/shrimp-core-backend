import {
  IsUUID,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
} from 'class-validator';

export class CreateTelemetryDto {
  @IsUUID()
  @IsNotEmpty()
  deviceId: string;

  @IsNumber()
  @IsOptional()
  temperature?: number;

  @IsNumber()
  @IsOptional()
  ph?: number;

  @IsNumber()
  @IsOptional()
  salinity?: number;

  @IsNumber()
  @IsOptional()
  dissolvedOxygen?: number;

  @IsNumber()
  @IsOptional()
  turbidity?: number;

  @IsNumber()
  @IsOptional()
  waterLevel?: number;

  @IsBoolean()
  @IsOptional()
  isBuffered?: boolean;

  @IsDateString()
  @IsOptional()
  recordedAt?: string;
}
