import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a unique correlation ID for a pipeline run.
 */
export function generateCorrelationId(): string {
  return uuidv4();
}
