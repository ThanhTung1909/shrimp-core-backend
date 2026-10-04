import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

export interface ErrorResponseBody {
  success: boolean;
  statusCode: number;
  message: string;
  errorCode: string;
  timestamp: string;
  path: string;
  errors?: string[] | null;
}

const VIETNAMESE_HTTP_MESSAGES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Yêu cầu không hợp lệ',
  [HttpStatus.UNAUTHORIZED]: 'Phiên làm việc không hợp lệ hoặc đã hết hạn',
  [HttpStatus.FORBIDDEN]: 'Bạn không có quyền truy cập chức năng này',
  [HttpStatus.NOT_FOUND]: 'Không tìm thấy tài nguyên yêu cầu',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Phương thức HTTP không được hỗ trợ',
  [HttpStatus.CONFLICT]: 'Dữ liệu bị xung đột hoặc đã tồn tại',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Lỗi hệ thống nội bộ, vui lòng thử lại sau',
};

const ENGLISH_DEFAULT_MESSAGES = new Set([
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Bad Request',
  'Internal Server Error',
  'Conflict',
  'Too Many Requests',
  'Forbidden Resource',
]);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Lỗi hệ thống nội bộ, vui lòng thử lại sau!';
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let errors: string[] | null = null;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorCode = HttpStatus[statusCode] || 'HTTP_ERROR';
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resObj = exceptionResponse as Record<string, any>;

        // Handle ValidationPipe array messages
        if (Array.isArray(resObj.message)) {
          message = 'Dữ liệu đầu vào không hợp lệ';
          errors = resObj.message;
          errorCode = 'VALIDATION_ERROR';
        } else {
          message = resObj.message || exception.message;
          errorCode =
            resObj.error
              ? String(resObj.error).toUpperCase().replace(/\s+/g, '_')
              : HttpStatus[statusCode] || 'HTTP_ERROR';
        }
      }

      // Tự động chuyển đổi các thông báo tiếng Anh mặc định của NestJS sang tiếng Việt
      if (ENGLISH_DEFAULT_MESSAGES.has(message) && VIETNAMESE_HTTP_MESSAGES[statusCode]) {
        message = VIETNAMESE_HTTP_MESSAGES[statusCode];
      }
    } else if (exception instanceof QueryFailedError) {
      const driverError = (exception as any).driverError;
      const dbCode = driverError?.code;

      switch (dbCode) {
        case '23505': // unique_violation
          statusCode = HttpStatus.CONFLICT;
          errorCode = 'DB_UNIQUE_VIOLATION';
          message =
            driverError?.detail ||
            'Dữ liệu đã tồn tại trong hệ thống (vi phạm ràng buộc duy nhất)';
          break;

        case '23503': // foreign_key_violation
          statusCode = HttpStatus.BAD_REQUEST;
          errorCode = 'DB_FOREIGN_KEY_VIOLATION';
          message =
            'Dữ liệu tham chiếu không tồn tại hoặc đang được sử dụng ở nơi khác';
          break;

        case '23502': // not_null_violation
          statusCode = HttpStatus.BAD_REQUEST;
          errorCode = 'DB_NOT_NULL_VIOLATION';
          message = 'Dữ liệu trường bắt buộc không được để trống';
          break;

        default:
          statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
          errorCode = 'DATABASE_ERROR';
          message = 'Lỗi truy vấn cơ sở dữ liệu';
          break;
      }

      this.logger.error(
        `[Database Error] Code: ${dbCode} | Path: ${request.url} | Message: ${exception.message}`,
        exception.stack,
      );
    } else if (exception instanceof Error) {
      message = exception.message || message;
      this.logger.error(
        `[Unhandled Error] Path: ${request.url} | Message: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(
        `[Unknown Exception] Path: ${request.url}`,
        JSON.stringify(exception),
      );
    }

    const responseBody: ErrorResponseBody = {
      success: false,
      statusCode,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: request.url || request.originalUrl,
      ...(errors && errors.length > 0 ? { errors } : {}),
    };

    response.status(statusCode).json(responseBody);
  }
}
