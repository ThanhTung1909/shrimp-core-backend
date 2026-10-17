import { IsOptional, IsString } from 'class-validator';

export class ResolveAlertDto {
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}
