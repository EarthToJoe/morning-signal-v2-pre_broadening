import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Parallel AI
  parallelAiApiKey: process.env.PARALLEL_AI_API_KEY || '',

  // SendGrid
  sendGridApiKey: process.env.SENDGRID_API_KEY || '',
  sendGridFromEmail: process.env.SENDGRID_FROM_EMAIL || 'newsletter@example.com',
  sendGridFromName: process.env.SENDGRID_FROM_NAME || 'The Morning Signal',

  // Database
  databaseUrl: process.env.DATABASE_URL || '',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'morning_signal_v2',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
  },

  // LLM Models (configurable, not hardcoded)
  llmModels: {
    contentResearcher: process.env.LLM_MODEL_RESEARCHER || 'gpt-4o-mini',
    storyWriterLead: process.env.LLM_MODEL_WRITER_LEAD || 'gpt-4o',
    storyWriterBriefings: process.env.LLM_MODEL_WRITER_BRIEFINGS || 'gpt-4o-mini',
    subjectLineGenerator: process.env.LLM_MODEL_SUBJECT_LINE || 'gpt-4o-mini',
  },

  // Application
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  // Cost
  costBudgetPerEdition: parseFloat(process.env.COST_BUDGET_PER_EDITION || '1.00'),

  // Newsletter
  newsletterName: process.env.NEWSLETTER_NAME || 'The Morning Signal',
  unsubscribeUrl: process.env.UNSUBSCRIBE_URL || 'https://example.com/unsubscribe',
  physicalAddress: process.env.PHYSICAL_ADDRESS || '123 Main St, Washington, DC 20001',
};
