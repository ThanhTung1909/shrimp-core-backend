import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor.js';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator.js';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator.js';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<any>;
  let reflector: Reflector;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let mockRequest: any;
  let mockResponse: any;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn(), get: vi.fn() } as unknown as Reflector;
    interceptor = new TransformInterceptor(reflector);

    mockRequest = { method: 'GET' };
    mockResponse = { statusCode: 200 };

    mockExecutionContext = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as any;
  });

  it('should transform plain object response into standard success structure', async () => {
    const responseData = { id: '123', name: 'Test Pond' };
    mockCallHandler = {
      handle: () => of(responseData),
    };

    const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result$.subscribe((result) => {
      expect(result).toEqual({
        success: true,
        statusCode: 200,
        message: 'Lấy dữ liệu thành công',
        data: responseData,
      });
    });
  });

  it('should extract message from response object if message property exists', async () => {
    const responseData = { message: 'Xóa ao nuôi thành công!' };
    mockCallHandler = {
      handle: () => of(responseData),
    };

    const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result$.subscribe((result) => {
      expect(result).toEqual({
        success: true,
        statusCode: 200,
        message: 'Xóa ao nuôi thành công!',
        data: null,
      });
    });
  });

  it('should extract message and preserve rest of payload if response object has message and other fields', async () => {
    const responseData = { message: 'Tạo người dùng thành công!', user: { id: '1', name: 'Alice' } };
    mockCallHandler = {
      handle: () => of(responseData),
    };

    const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result$.subscribe((result) => {
      expect(result).toEqual({
        success: true,
        statusCode: 200,
        message: 'Tạo người dùng thành công!',
        data: { user: { id: '1', name: 'Alice' } },
      });
    });
  });

  it('should use custom message set via @ResponseMessage decorator', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === RESPONSE_MESSAGE_KEY) return 'Custom Success Message';
      return undefined;
    });

    const responseData = { count: 5 };
    mockCallHandler = {
      handle: () => of(responseData),
    };

    const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result$.subscribe((result) => {
      expect(result).toEqual({
        success: true,
        statusCode: 200,
        message: 'Custom Success Message',
        data: responseData,
      });
    });
  });

  it('should skip transformation when @SkipTransform decorator is present', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === SKIP_TRANSFORM_KEY) return true;
      return undefined;
    });

    const rawData = { raw: 'data' };
    mockCallHandler = {
      handle: () => of(rawData),
    };

    const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result$.subscribe((result) => {
      expect(result).toEqual(rawData);
    });
  });
});
