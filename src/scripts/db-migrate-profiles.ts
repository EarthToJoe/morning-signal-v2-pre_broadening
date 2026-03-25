import { pool } from '../config/database';
import { logger } from '../utils/logger';

const migration = `
-- Newsletter Profiles table
CREATE TABLE IF NOT EXISTS newsletter_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  audience TEXT NOT NULL DEFAULT '',
  is_preset BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add profile support to topic_config
ALTER TABLE topic_config ADD COLUMN IF NOT EXISTS objective TEXT;
ALTER TABLE topic_config ADD COLUMN IF NOT EXISTS preferred_sources TEXT;
ALTER TABLE topic_config ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES newsletter_profiles(id) ON DELETE CASCADE;

-- Drop the unique constraint on category so multiple profiles can have same category names
ALTER TABLE topic_config DROP CONSTRAINT IF EXISTS topic_config_category_key;

-- Add a unique constraint on (profile_id, category) instead
-- This allows "defense" in profile A and "defense" in profile B
CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_config_profile_category ON topic_config(profile_id, category) WHERE profile_id IS NOT NULL;

-- Link editions to profiles
ALTER TABLE editions ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES newsletter_profiles(id);
`;

async function run() {
  logger.info('Running profiles migration...', { component: 'db-migrate-profiles' });
  try {
    await pool.query(migration);
    logger.info('Profiles migration completed', { component: 'db-migrate-profiles' });

    // Create the default Morning Signal profile and link existing topic_config rows to it
    const existing = await pool.query("SELECT id FROM newsletter_profiles WHERE name = 'The Morning Signal'");
    if (existing.rows.length === 0) {
      const result = await pool.query(
        "INSERT INTO newsletter_profiles (name, audience, is_preset) VALUES ($1, $2, true) RETURNING id",
        ['The Morning Signal', 'Senior government, military, and industry decision-makers in defense, energy, and technology sectors']
      );
      const profileId = result.rows[0].id;

      // Link existing topic configs to this profile
      await pool.query("UPDATE topic_config SET profile_id = $1 WHERE profile_id IS NULL", [profileId]);

      // Set objectives on existing categories
      const objectives: Record<string, string> = {
        defense: 'Topic: U.S. and allied defense developments including military contracts, weapons programs, force posture changes, Pentagon policy, NATO operations, defense industry news, and military technology. Preferred sources: Defense News, Breaking Defense, Defense One, Military Times, Stars and Stripes, Reuters, AP, USNI News.',
        energy: 'Topic: Energy sector developments including oil & gas markets, renewable energy projects, grid infrastructure, nuclear energy policy, energy legislation, utility company news, and energy technology. Preferred sources: E&E News, Utility Dive, Reuters, Bloomberg Energy, S&P Global, Rigzone.',
        technology: 'Topic: Technology developments relevant to government and enterprise including cybersecurity incidents, AI policy and regulation, cloud computing contracts, semiconductor supply chain, space technology, and federal IT modernization. Preferred sources: Ars Technica, The Verge, Wired, Federal News Network, NextGov, CyberScoop.',
        policy: 'Topic: U.S. government policy affecting defense, energy, and technology sectors including executive orders, congressional legislation, regulatory actions, budget decisions, and agency leadership changes. Preferred sources: Politico, The Hill, Reuters, AP, Federal News Network, Roll Call.',
      };
      for (const [cat, obj] of Object.entries(objectives)) {
        await pool.query("UPDATE topic_config SET objective = $1 WHERE category = $2 AND profile_id = $3", [obj, cat, profileId]);
      }

      logger.info('Morning Signal profile created and linked', { component: 'db-migrate-profiles', profileId });
    }
  } catch (error: any) {
    logger.error('Profiles migration failed', { component: 'db-migrate-profiles', error: error.message });
    throw error;
  } finally {
    await pool.end();
  }
}

run().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
