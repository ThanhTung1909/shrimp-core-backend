import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'skip_transform';

/**
 * Decorator bỏ qua việc biến đổi chuẩn hóa dữ liệu trả về từ TransformInterceptor.
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
