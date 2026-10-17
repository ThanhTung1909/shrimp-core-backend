import { IsOptional, IsUUID } from 'class-validator';

export class AssignPondDto {
  @IsOptional()
  @IsUUID('4', { message: 'ID ao nuôi phải là định dạng UUID hợp lệ!' })
  pondId: string | null;
}
