/**
 * Combined database initialization: runs migration then seed.
 * Usage: npx ts-node src/scripts/db-init.ts
 */
import { logger } from '../utils/logger';

async function init() {
  logger.info('Initializing database...', { component: 'db-init' });

  logger.info('Running migration...', { component: 'db-init' });
  await import('./db-migrate');

  // Small delay to let migration complete
  await new Promise(r => setTimeout(r, 2000));

  logger.info('Running seed...', { component: 'db-init' });
  await import('./db-seed');
}

init().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
