import type { Request, Response, NextFunction } from 'express';

import { RateLimitService } from '../redis/rate-limit.service.js';

const SWAGGER_LIMIT = 60;
const SWAGGER_WINDOW_SECONDS = 60;

/**
 * Swagger routes are registered directly with Express and therefore do not
 * pass through Nest's APP_GUARD. This middleware gives documentation routes
 * the same 60 requests/minute policy without double-counting controller APIs.
 */
export function createSwaggerRateLimitMiddleware(
  rateLimitService: RateLimitService,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    try {
      const result = await rateLimitService.checkLimit(
        `rl:swagger:ip:${clientIp}`,
        SWAGGER_LIMIT,
        SWAGGER_WINDOW_SECONDS,
      );

      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        return res.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Please try again later.',
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }

      return next();
    } catch {
      // Fail closed: do not let a Redis outage silently remove the limiter.
      return res.status(503).json({
        statusCode: 503,
        message: 'Rate-limit service is temporarily unavailable.',
      });
    }
  };
}
