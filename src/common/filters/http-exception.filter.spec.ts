import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter.js';
import { QueryFailedError } from 'typeorm';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockRequest = {
      url: '/test-endpoint',
      originalUrl: '/test-endpoint',
    };

    mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as any;
  });

  it('should handle standard HttpException correctly', () => {
    const exception = new HttpException('Forbidden Resource', HttpStatus.FORBIDDEN);

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Bạn không có quyền truy cập chức năng này',
        errorCode: 'FORBIDDEN',
        path: '/test-endpoint',
      }),
    );
  });

  it('should handle ValidationPipe array messages correctly', () => {
    const exception = new BadRequestException({
      statusCode: 400,
      message: ['email must be an email', 'password is too short'],
      error: 'Bad Request',
    });

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 400,
        message: 'Dữ liệu đầu vào không hợp lệ',
        errorCode: 'VALIDATION_ERROR',
        errors: ['email must be an email', 'password is too short'],
      }),
    );
  });

  it('preserves custom authentication code and retryAfterSeconds', () => {
    const exception = new HttpException(
      {
        code: 'LOGIN_TEMPORARILY_LOCKED',
        message: 'Tài khoản tạm thời bị khóa.',
        retryAfterSeconds: 30,
      },
      HttpStatus.UNAUTHORIZED,
    );

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: 'LOGIN_TEMPORARILY_LOCKED',
        message: 'Tài khoản tạm thời bị khóa.',
        retryAfterSeconds: 30,
      }),
    );
  });

  it('preserves permanent login lock code without adding retryAfterSeconds', () => {
    const exception = new HttpException(
      {
        code: 'LOGIN_PERMANENTLY_LOCKED',
        message: 'Vui lòng liên hệ quản lý',
      },
      HttpStatus.UNAUTHORIZED,
    );

    filter.catch(exception, mockArgumentsHost);

    const responseBody = mockResponse.json.mock.calls[0][0];
    expect(responseBody.errorCode).toBe('LOGIN_PERMANENTLY_LOCKED');
    expect(responseBody).not.toHaveProperty('retryAfterSeconds');
  });

  it('should handle TypeORM QueryFailedError with unique constraint (23505)', () => {
    const queryError = new QueryFailedError('SELECT 1', [], new Error('duplicate key'));
    (queryError as any).driverError = {
      code: '23505',
      detail: 'Key (mac_address)=(00:11:22:33:44:55) already exists.',
    };

    filter.catch(queryError, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: HttpStatus.CONFLICT,
        errorCode: 'DB_UNIQUE_VIOLATION',
        message: 'Key (mac_address)=(00:11:22:33:44:55) already exists.',
      }),
    );
  });

  it('should handle TypeORM QueryFailedError with foreign key constraint (23503)', () => {
    const queryError = new QueryFailedError('SELECT 1', [], new Error('fk error'));
    (queryError as any).driverError = {
      code: '23503',
    };

    filter.catch(queryError, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: 'DB_FOREIGN_KEY_VIOLATION',
      }),
    );
  });

  it('should handle generic Error as 500 Internal Server Error', () => {
    const error = new Error('Unexpected system crash');

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Unexpected system crash',
        errorCode: 'INTERNAL_SERVER_ERROR',
      }),
    );
  });
});
