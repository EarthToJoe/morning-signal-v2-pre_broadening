import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

/**
 * Centralized error handler for Express.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const correlationId = req.correlationId || 'unknown';

  logger.error('Unhandled error', {
    correlationId,
    component: 'error-handler',
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal server error',
    correlationId,
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
