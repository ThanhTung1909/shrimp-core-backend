import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response_message';

/**
 * Decorator chỉ định thông điệp phản hồi tùy chỉnh cho API endpoint.
 * @param message Thông điệp phản hồi thành công
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
