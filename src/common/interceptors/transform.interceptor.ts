import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator.js';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator.js';

export interface StandardSuccessResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T | null;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, StandardSuccessResponse<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const isSkipTransform = this.reflector.getAllAndOverride<boolean>(
      SKIP_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isSkipTransform) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const statusCode = response.statusCode || 200;

    const customMessage = this.reflector.getAllAndOverride<string>(
      RESPONSE_MESSAGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    return next.handle().pipe(
      map((resData) => {
        let finalMessage = customMessage || this.getDefaultMessage(request.method);
        let payload: any = resData;

        if (
          resData !== null &&
          typeof resData === 'object' &&
          !Array.isArray(resData)
        ) {
          // If controller response explicitly contains a message string
          if (typeof resData.message === 'string') {
            if (!customMessage) {
              finalMessage = resData.message;
            }
            const { message: _msg, ...rest } = resData;
            // If object only had message property, payload data is null
            payload = Object.keys(rest).length > 0 ? rest : null;
          }
        }

        if (payload === undefined) {
          payload = null;
        }

        return {
          success: true,
          statusCode,
          message: finalMessage,
          data: payload,
        };
      }),
    );
  }

  private getDefaultMessage(method: string): string {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'Lấy dữ liệu thành công';
      case 'POST':
        return 'Tạo mới dữ liệu thành công';
      case 'PUT':
      case 'PATCH':
        return 'Cập nhật dữ liệu thành công';
      case 'DELETE':
        return 'Xóa dữ liệu thành công';
      default:
        return 'Thao tác thành công';
    }
  }
}
