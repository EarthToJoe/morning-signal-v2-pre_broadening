// ============================================
// Morning Signal V2 — Core Type Definitions
// ============================================

export type TopicCategory = string;
export type EditionStatus = 'discovery' | 'clustering' | 'awaiting_selection' | 'writing' | 'awaiting_review' | 'approved' | 'delivered' | 'failed';
export type StoryRole = 'lead_story' | 'quick_hit' | 'watch_list';
export type DiscoverySource = 'search_api' | 'custom_search' | 'manual_url';
export type EditorialActionType = 'select_stories' | 'reorder' | 'assign_role' | 'approve' | 'reject' | 'edit_content' | 'regenerate_section' | 'custom_search' | 'manual_story' | 'edit_prompt' | 'save_prompt' | 'revert_prompt';
export type PipelineStage = 'content_researcher' | 'story_writer_lead' | 'story_writer_briefings' | 'story_writer_quick_hits' | 'story_writer_watch_list' | 'subject_line_generator';
export type SubscriptionStatus = 'active' | 'unsubscribed';

// --- Search & Discovery ---

export interface SearchQuery {
  category: TopicCategory;
  query: string;
  maxResults: number;
}

export interface RawSearchResult {
  url: string;
  title: string;
  snippet: string;
  source: string;
  publishedDate?: string;
  rankPosition: number;
}

export interface DiscoveredArticle {
  id: string;
  url: string;
  title: string;
  snippet: string;
  source: string;
  publishedAt?: Date;
  rankPosition: number;
  category: TopicCategory;
  discoveredVia: DiscoverySource;
}

export interface ArticleDiscoveryResult {
  articles: DiscoveredArticle[];
  totalFound: number;
  duplicatesRemoved: number;
  categoryCoverage: Record<string, number>;
  searchApiCalls: number;
  warnings: string[];
}

// --- Story Candidates ---

export interface StoryCandidate {
  id: string;
  suggestedRole: StoryRole;
  headline: string;
  narrativeSummary: string;
  sourceArticleIds: string[];
  sourceArticles: DiscoveredArticle[];
  category: TopicCategory;
  isManualStory: boolean;
  manualStoryAttribution?: string;
}

export interface ClusteringResult {
  storyCandidates: StoryCandidate[];
  lowRelevanceArticleIds: string[];
  lowRelevanceReasons: Record<string, string>;
  tokenUsage: { input: number; output: number };
  cost: number;
}

// --- Editor Selections ---

export interface EditorSelection {
  leadStory: StoryCandidate;
  quickHits: StoryCandidate[];
  watchListItems: StoryCandidate[];
}

// --- Written Content ---

export interface WrittenSection {
  role: StoryRole;
  storyCandidateId: string;
  headline: string;
  htmlContent: string;
  plainTextContent: string;
  wordCount: number;
  sourceLinks: { url: string; anchorText: string }[];
}

export interface WrittenNewsletter {
  leadStory: WrittenSection;
  quickHits: WrittenSection[];
  watchList: WrittenSection[];
  totalWordCount: number;
  tokenUsage: { input: number; output: number };
  cost: number;
}

// --- Subject Lines ---

export interface SubjectLineResult {
  options: string[];
  tokenUsage: { input: number; output: number };
  cost: number;
}

// --- Newsletter Assembly ---

export interface AssembledNewsletter {
  html: string;
  plainText: string;
  editionNumber: number;
  editionDate: string;
  sectionMetadata: {
    role: string;
    headline: string;
    wordCount: number;
  }[];
}

// --- Email ---

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface DeliveryReport {
  deliveryId: string;
  totalSent: number;
  failureCount: number;
  failures: { email: string; error: string }[];
  deliveredAt: Date;
}

// --- Prompts ---

export interface ManagedPrompt {
  stage: PipelineStage;
  promptText: string;
  isDefault: boolean;
  savedAt: Date;
}

// --- Cost ---

export interface CostEntry {
  id: string;
  correlationId: string;
  stage: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  apiCalls: number;
  cost: number;
  recordedAt: Date;
}

export interface EditionCostSummary {
  correlationId: string;
  searchCost: number;
  researchCost: number;
  writingCost: number;
  subjectLineCost: number;
  totalCost: number;
  llmCallCount: number;
  searchApiCallCount: number;
  customSearchCallCount: number;
  manualStoryCount: number;
  isOverBudget: boolean;
}

// --- Pipeline ---

export interface PipelineRunStatus {
  correlationId: string;
  currentStage: string;
  status: 'running' | 'awaiting_editor' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  warnings: string[];
  costSummary?: EditionCostSummary;
}

// --- URL Fetcher ---

export interface FetchedArticleMetadata {
  url: string;
  title: string;
  snippet: string;
  source: string;
  publishedAt?: Date;
  success: boolean;
  error?: string;
}

// --- Edition ---

export interface Edition {
  id: string;
  correlationId: string;
  status: EditionStatus;
  startedAt: Date;
  completedAt?: Date;
  editionNumber: number;
  editionDate: string;
  totalCost: number;
  isOverBudget: boolean;
  warnings: string[];
}

// --- Subscriber ---

export interface Subscriber {
  id: string;
  email: string;
  status: SubscriptionStatus;
  subscribedAt: Date;
  unsubscribedAt?: Date;
}

// --- Topic Config ---

export interface TopicConfig {
  id: string;
  category: TopicCategory;
  displayName: string;
  searchQueries: string[];
  objective?: string;           // Custom Parallel AI objective for this category
  preferredSources?: string;    // Comma-separated preferred source domains
  priority: number;
  isActive: boolean;
  profileId?: string;           // Which newsletter profile this belongs to
}

// --- Newsletter Profile ---

export interface NewsletterProfile {
  id: string;
  name: string;                 // "The Morning Signal", "Tech Pulse", etc.
  audience: string;             // "Senior defense/energy/tech professionals"
  isPreset: boolean;            // true = built-in preset, false = user-created
  createdAt: Date;
}
