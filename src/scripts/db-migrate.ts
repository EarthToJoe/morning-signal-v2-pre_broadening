import { pool } from '../config/database';
import { logger } from '../utils/logger';

const migration = `
-- Morning Signal V2 — Database Schema (13 tables)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. editions
CREATE TABLE IF NOT EXISTS editions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  correlation_id VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'discovery',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  edition_number INTEGER,
  edition_date DATE,
  total_cost DECIMAL(10, 6) DEFAULT 0,
  is_over_budget BOOLEAN DEFAULT FALSE,
  warnings JSONB DEFAULT '[]'::jsonb
);

-- 2. articles
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  url VARCHAR(2048) NOT NULL,
  title VARCHAR(1024) NOT NULL,
  snippet TEXT,
  source VARCHAR(512),
  published_at TIMESTAMP,
  rank_position INTEGER DEFAULT 0,
  category VARCHAR(50),
  discovered_via VARCHAR(50) DEFAULT 'search_api',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. story_candidates
CREATE TABLE IF NOT EXISTS story_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  suggested_role VARCHAR(50),
  assigned_role VARCHAR(50),
  headline VARCHAR(1024),
  narrative_summary TEXT,
  category VARCHAR(50),
  is_manual_story BOOLEAN DEFAULT FALSE,
  manual_story_attribution VARCHAR(255),
  is_selected BOOLEAN DEFAULT FALSE,
  display_order INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 4. story_candidate_articles (join table)
CREATE TABLE IF NOT EXISTS story_candidate_articles (
  story_candidate_id UUID NOT NULL REFERENCES story_candidates(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  PRIMARY KEY (story_candidate_id, article_id)
);

-- 5. written_sections
CREATE TABLE IF NOT EXISTS written_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  story_candidate_id UUID REFERENCES story_candidates(id) ON DELETE SET NULL,
  role VARCHAR(50) NOT NULL,
  headline VARCHAR(1024),
  html_content TEXT,
  plain_text_content TEXT,
  word_count INTEGER DEFAULT 0,
  source_links JSONB DEFAULT '[]'::jsonb,
  written_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 6. assembled_newsletters
CREATE TABLE IF NOT EXISTS assembled_newsletters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID UNIQUE NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  html_content TEXT,
  plain_text_content TEXT,
  selected_subject_line VARCHAR(255),
  subject_line_options JSONB DEFAULT '[]'::jsonb,
  section_metadata JSONB DEFAULT '[]'::jsonb,
  assembled_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 7. cost_entries
CREATE TABLE IF NOT EXISTS cost_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  stage VARCHAR(100) NOT NULL,
  provider VARCHAR(100) NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  cost DECIMAL(10, 6) DEFAULT 0,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 8. editorial_actions
CREATE TABLE IF NOT EXISTS editorial_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,
  action_data JSONB DEFAULT '{}'::jsonb,
  performed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 9. saved_prompts
CREATE TABLE IF NOT EXISTS saved_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stage VARCHAR(100) UNIQUE NOT NULL,
  prompt_text TEXT NOT NULL,
  is_system_default BOOLEAN DEFAULT TRUE,
  saved_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 10. subscribers
CREATE TABLE IF NOT EXISTS subscribers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(512) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  subscribed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMP
);

-- 11. delivery_reports
CREATE TABLE IF NOT EXISTS delivery_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  total_sent INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  delivered_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 12. delivery_failures
CREATE TABLE IF NOT EXISTS delivery_failures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_report_id UUID NOT NULL REFERENCES delivery_reports(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
  error_reason VARCHAR(1024),
  failed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 13. topic_config
CREATE TABLE IF NOT EXISTS topic_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  search_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_articles_edition_id ON articles(edition_id);
CREATE INDEX IF NOT EXISTS idx_story_candidates_edition_id ON story_candidates(edition_id);
CREATE INDEX IF NOT EXISTS idx_written_sections_edition_id ON written_sections(edition_id);
CREATE INDEX IF NOT EXISTS idx_cost_entries_edition_id ON cost_entries(edition_id);
CREATE INDEX IF NOT EXISTS idx_editorial_actions_edition_id ON editorial_actions(edition_id);
CREATE INDEX IF NOT EXISTS idx_editions_correlation_id ON editions(correlation_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
`;

async function migrate() {
  logger.info('Running database migration...', { component: 'db-migrate' });
  try {
    await pool.query(migration);
    logger.info('Migration completed successfully', { component: 'db-migrate' });
  } catch (error: any) {
    logger.error('Migration failed', { component: 'db-migrate', error: error.message });
    throw error;
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
