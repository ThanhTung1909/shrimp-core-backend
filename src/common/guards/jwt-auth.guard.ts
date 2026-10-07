import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const authenticated = await Promise.resolve(super.canActivate(context));
    if (!authenticated) {
      return false;
    }

    const allowMustChangePassword = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MUST_CHANGE_PASSWORD_KEY,
      [context.getHandler(), context.getClass()],
    );

    const user = context.switchToHttp().getRequest().user as
      | { mustChangePassword?: boolean }
      | undefined;

    if (user?.mustChangePassword && !allowMustChangePassword) {
      throw new ForbiddenException(
        'Bạn phải thay đổi mật khẩu trước khi sử dụng chức năng này!',
      );
    }

    return true;
  }

  override handleRequest<TUser = any>(err: any, user: any, info: any): TUser {
    if (err || !user) {
      throw (
        err ||
        new UnauthorizedException(
          'Phiên làm việc không hợp lệ hoặc đã hết hạn!',
        )
      );
    }

    return user;
  }
}
