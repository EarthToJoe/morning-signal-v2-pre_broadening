import { Request, Response, NextFunction } from 'express';
import { generateCorrelationId } from '../../pipeline/correlation';

// Extend Express Request to include correlationId
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Middleware that attaches a correlation ID to every request.
 * Uses X-Correlation-ID header if provided, otherwise generates a new one.
 */
export function correlationMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  next();
}
