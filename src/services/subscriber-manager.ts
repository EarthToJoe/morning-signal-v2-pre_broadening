import { query } from '../config/database';
import { logger } from '../utils/logger';
import { Subscriber } from '../types';

// Basic RFC 5322 simplified email pattern
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export class SubscriberManagerService {
  /**
   * Validate email format.
   */
  isValidEmail(email: string): boolean {
    return EMAIL_REGEX.test(email) && email.length <= 512;
  }

  /**
   * Add a new subscriber.
   */
  async addSubscriber(email: string): Promise<Subscriber> {
    const normalized = email.trim().toLowerCase();
    if (!this.isValidEmail(normalized)) {
      throw new Error(`Invalid email format: ${email}`);
    }

    // Check if already exists
    const existing = await query('SELECT * FROM subscribers WHERE email = $1', [normalized]);
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'unsubscribed') {
        // Re-subscribe
        await query(
          'UPDATE subscribers SET status = $1, unsubscribed_at = NULL WHERE id = $2',
          ['active', row.id]
        );
        logger.info('Subscriber re-activated', { component: 'subscriber-manager', email: normalized });
        return { ...this.mapRow(row), status: 'active', unsubscribedAt: undefined };
      }
      return this.mapRow(row);
    }

    const result = await query(
      'INSERT INTO subscribers (email, status) VALUES ($1, $2) RETURNING *',
      [normalized, 'active']
    );

    logger.info('Subscriber added', { component: 'subscriber-manager', email: normalized });
    return this.mapRow(result.rows[0]);
  }

  /**
   * Unsubscribe a subscriber by ID.
   */
  async unsubscribe(id: string): Promise<void> {
    await query(
      'UPDATE subscribers SET status = $1, unsubscribed_at = NOW() WHERE id = $2',
      ['unsubscribed', id]
    );
    logger.info('Subscriber unsubscribed', { component: 'subscriber-manager', id });
  }

  /**
   * Get all active subscribers.
   */
  async getActiveSubscribers(): Promise<Subscriber[]> {
    const result = await query("SELECT * FROM subscribers WHERE status = 'active' ORDER BY subscribed_at");
    return result.rows.map(this.mapRow);
  }

  /**
   * Get all subscribers (any status).
   */
  async getAllSubscribers(): Promise<Subscriber[]> {
    const result = await query('SELECT * FROM subscribers ORDER BY subscribed_at');
    return result.rows.map(this.mapRow);
  }

  /**
   * Get subscriber by ID.
   */
  async getById(id: string): Promise<Subscriber | null> {
    const result = await query('SELECT * FROM subscribers WHERE id = $1', [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: any): Subscriber {
    return {
      id: row.id,
      email: row.email,
      status: row.status,
      subscribedAt: new Date(row.subscribed_at),
      unsubscribedAt: row.unsubscribed_at ? new Date(row.unsubscribed_at) : undefined,
    };
  }
}
