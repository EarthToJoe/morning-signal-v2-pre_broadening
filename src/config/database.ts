import { Pool } from 'pg';
import { config } from './index';
import { logger } from '../utils/logger';

const pool = new Pool(
  config.databaseUrl
    ? { connectionString: config.databaseUrl, ssl: config.db.ssl ? { rejectUnauthorized: false } : false }
    : {
        host: config.db.host,
        port: config.db.port,
        database: config.db.name,
        user: config.db.user,
        password: config.db.password,
        ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
      }
);

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { component: 'database', error: err.message });
});

export { pool };

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug('Executed query', { component: 'database', query: text.substring(0, 80), duration, rows: result.rowCount });
  return result;
}

export async function getClient() {
  return pool.connect();
}
