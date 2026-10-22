
import { Matches } from 'class-validator';

export class AssignFarmerDto {
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    {
      message: 'farmerId phải có định dạng UUID hợp lệ!',
    },
  )
  farmerId: string;
}
