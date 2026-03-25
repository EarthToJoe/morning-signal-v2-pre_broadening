import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { createCorrelatedLogger } from '../utils/logger';
import { generateCorrelationId } from './correlation';
import { ArticleDiscoveryService, ParallelAiClient } from '../services/article-discovery';
import { ContentResearcherService } from '../services/content-researcher';
import { StoryWriterService } from '../services/story-writer';
import { SubjectLineGeneratorService } from '../services/subject-line-generator';
import { NewsletterAssemblerService } from '../services/newsletter-assembler';
import { EmailDeliveryService } from '../services/email-delivery';
import { CostTrackerService } from '../services/cost-tracker';
import { PromptManagerService } from '../services/prompt-manager';
import { SubscriberManagerService } from '../services/subscriber-manager';
import { config } from '../config';
import {
  PipelineRunStatus, EditorSelection, TopicConfig,
  DiscoveredArticle, StoryCandidate, WrittenNewsletter,
  AssembledNewsletter, EditionCostSummary,
} from '../types';

interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY: RetryConfig = { maxAttempts: 3, baseDelayMs: 1000, backoffMultiplier: 2 };

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry<T>(
  operation: () => Promise<T>,
  retryConfig: RetryConfig,
  correlationId: string,
  componentName: string,
  log: any
): Promise<T> {
  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      if (attempt === retryConfig.maxAttempts) {
        log.error('Operation failed after retries', { correlationId, component: componentName, attempt, error: error.message });
        throw error;
      }
      const delay = retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1);
      log.warn('Retrying operation', { correlationId, component: componentName, attempt, nextRetryMs: delay, error: error.message });
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}

export class PipelineOrchestrator {
  private articleDiscovery: ArticleDiscoveryService;
  private contentResearcher: ContentResearcherService;
  private storyWriter: StoryWriterService;
  private subjectLineGenerator: SubjectLineGeneratorService;
  private newsletterAssembler: NewsletterAssemblerService;
  private emailDelivery: EmailDeliveryService;
  private costTracker: CostTrackerService;

  constructor() {
    this.costTracker = new CostTrackerService();
    const promptManager = new PromptManagerService();
    const subscriberManager = new SubscriberManagerService();
    const searchClient = new ParallelAiClient(config.parallelAiApiKey);

    this.articleDiscovery = new ArticleDiscoveryService(searchClient, this.costTracker);
    this.contentResearcher = new ContentResearcherService(promptManager, this.costTracker);
    this.storyWriter = new StoryWriterService(promptManager, this.costTracker);
    this.subjectLineGenerator = new SubjectLineGeneratorService(promptManager, this.costTracker);
    this.newsletterAssembler = new NewsletterAssemblerService();
    this.emailDelivery = new EmailDeliveryService(subscriberManager);
  }

  /**
   * Start a new pipeline run (Phase 1: discovery + clustering).
   */
  async startPipeline(correlationId?: string, promptOverride?: string | null, profileId?: string, daysBack?: number, editionNumberOverride?: number): Promise<PipelineRunStatus> {
    const corrId = correlationId || generateCorrelationId();
    const log = createCorrelatedLogger(corrId, 'orchestrator');

    log.info('Pipeline started');

    // Create edition record
    const editionNumber = editionNumberOverride || await this.getNextEditionNumber(profileId);
    const editionDate = new Date().toISOString().split('T')[0];

    await query(
      `INSERT INTO editions (correlation_id, status, edition_number, edition_date, profile_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [corrId, 'discovery', editionNumber, editionDate, profileId || null]
    );

    try {
      // Stage 1: Article Discovery
      await this.updateStatus(corrId, 'discovery');
      const topicConfigs = await this.getTopicConfigs(profileId);

      const discoveryResult = await withRetry(
        () => this.articleDiscovery.discoverArticles(topicConfigs, corrId, daysBack),
        DEFAULT_RETRY, corrId, 'article-discovery', log
      );

      // Persist articles
      const editionId = await this.getEditionId(corrId);
      for (const article of discoveryResult.articles) {
        await query(
          `INSERT INTO articles (id, edition_id, url, title, snippet, source, published_at, rank_position, category, discovered_via)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [article.id, editionId, article.url, article.title, article.snippet, article.source,
           article.publishedAt || null, article.rankPosition, article.category, article.discoveredVia]
        );
      }

      // Update warnings
      if (discoveryResult.warnings.length > 0) {
        await query('UPDATE editions SET warnings = $1 WHERE correlation_id = $2',
          [JSON.stringify(discoveryResult.warnings), corrId]);
      }

      // Stage 2: Content Researcher (clustering)
      await this.updateStatus(corrId, 'clustering');

      const clusteringResult = await withRetry(
        () => this.contentResearcher.clusterArticles(discoveryResult.articles, promptOverride || null, corrId),
        DEFAULT_RETRY, corrId, 'content-researcher', log
      );

      // Persist story candidates
      for (const candidate of clusteringResult.storyCandidates) {
        await query(
          `INSERT INTO story_candidates (id, edition_id, suggested_role, headline, narrative_summary, category, is_manual_story)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [candidate.id, editionId, candidate.suggestedRole, candidate.headline,
           candidate.narrativeSummary, candidate.category, candidate.isManualStory]
        );
        // Link articles
        for (const articleId of candidate.sourceArticleIds) {
          await query(
            'INSERT INTO story_candidate_articles (story_candidate_id, article_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [candidate.id, articleId]
          );
        }
      }

      // Awaiting editor selection
      await this.updateStatus(corrId, 'awaiting_selection');

      log.info('Phase 1 complete — awaiting editor selection', {
        articles: discoveryResult.articles.length,
        candidates: clusteringResult.storyCandidates.length,
      });

      return this.buildStatus(corrId, 'awaiting_selection', 'awaiting_editor');

    } catch (error: any) {
      log.error('Pipeline Phase 1 failed', { error: error.message });
      await this.updateStatus(corrId, 'failed');
      return this.buildStatus(corrId, 'failed', 'failed', [error.message]);
    }
  }

  /**
   * Continue pipeline after editor selection (Phase 2: writing + assembly).
   */
  async continueAfterSelection(
    correlationId: string,
    selections: EditorSelection,
    promptOverrides?: { lead?: string | null; briefings?: string | null; subjectLine?: string | null }
  ): Promise<PipelineRunStatus> {
    const log = createCorrelatedLogger(correlationId, 'orchestrator');
    const editionId = await this.getEditionId(correlationId);

    log.info('Phase 2 started — writing selected stories', {
      leadStory: selections.leadStory.headline,
      quickHitCount: selections.quickHits.length,
      watchListCount: selections.watchListItems.length,
    });

    // Record editorial action
    await this.recordEditorialAction(editionId, 'select_stories', {
      leadStoryId: selections.leadStory.id,
      quickHitIds: selections.quickHits.map(q => q.id),
      watchListIds: selections.watchListItems.map(w => w.id),
    });

    // Mark selected candidates in DB
    const allSelected = [selections.leadStory, ...selections.quickHits, ...selections.watchListItems];
    for (let i = 0; i < allSelected.length; i++) {
      const c = allSelected[i];
      const role = c === selections.leadStory ? 'lead_story'
        : selections.quickHits.includes(c) ? 'quick_hit' : 'watch_list';
      await query(
        'UPDATE story_candidates SET is_selected = true, assigned_role = $1, display_order = $2 WHERE id = $3',
        [role, i, c.id]
      );
    }

    try {
      // Stage 3: Story Writing
      await this.updateStatus(correlationId, 'writing');

      // Lead story — dedicated LLM call
      let leadSection;
      try {
        leadSection = await withRetry(
          () => this.storyWriter.writeLeadStory(selections.leadStory, promptOverrides?.lead || null, correlationId),
          DEFAULT_RETRY, correlationId, 'story-writer-lead', log
        );
      } catch (err: any) {
        log.error('Lead story writing failed', { error: err.message });
        leadSection = this.createFailedSection('lead_story', selections.leadStory);
      }

      // Briefings — single LLM call
      let briefingsResult;
      try {
        briefingsResult = await withRetry(
          () => this.storyWriter.writeBriefings(
            selections.quickHits, selections.watchListItems,
            promptOverrides?.briefings || null, correlationId
          ),
          DEFAULT_RETRY, correlationId, 'story-writer-briefings', log
        );
      } catch (err: any) {
        log.error('Briefings writing failed', { error: err.message });
        briefingsResult = { quickHits: [], watchList: [] };
      }

      const writtenNewsletter: WrittenNewsletter = {
        leadStory: leadSection,
        quickHits: briefingsResult.quickHits,
        watchList: briefingsResult.watchList,
        totalWordCount: leadSection.wordCount
          + briefingsResult.quickHits.reduce((sum, qh) => sum + qh.wordCount, 0)
          + briefingsResult.watchList.reduce((sum, wl) => sum + wl.wordCount, 0),
        tokenUsage: { input: 0, output: 0 }, // Tracked per-call in cost tracker
        cost: 0, // Tracked per-call in cost tracker
      };

      // Persist written sections
      const allSections = [leadSection, ...briefingsResult.quickHits, ...briefingsResult.watchList];
      for (const section of allSections) {
        await query(
          `INSERT INTO written_sections (edition_id, story_candidate_id, role, headline, html_content, plain_text_content, word_count, source_links)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [editionId, section.storyCandidateId || null, section.role, section.headline,
           section.htmlContent, section.plainTextContent, section.wordCount, JSON.stringify(section.sourceLinks)]
        );
      }

      // Stage 4: Subject Line Generation
      let subjectLineResult;
      try {
        subjectLineResult = await withRetry(
          () => this.subjectLineGenerator.generateSubjectLines(writtenNewsletter, promptOverrides?.subjectLine || null, correlationId),
          DEFAULT_RETRY, correlationId, 'subject-line-generator', log
        );
      } catch (err: any) {
        log.warn('Subject line generation failed, using fallback', { error: err.message });
        const editionDate = new Date().toISOString().split('T')[0];
        subjectLineResult = { options: [`${config.newsletterName} — ${editionDate}`], tokenUsage: { input: 0, output: 0 }, cost: 0 };
      }

      // Stage 5: Newsletter Assembly
      const edition = await this.getEdition(correlationId);
      const assembled = await this.newsletterAssembler.assemble(
        writtenNewsletter,
        subjectLineResult.options[0],
        edition.editionNumber,
        edition.editionDate,
        correlationId,
        undefined,
        edition.newsletterName
      );

      // Persist assembled newsletter
      await query(
        `INSERT INTO assembled_newsletters (edition_id, html_content, plain_text_content, selected_subject_line, subject_line_options, section_metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [editionId, assembled.html, assembled.plainText, subjectLineResult.options[0],
         JSON.stringify(subjectLineResult.options), JSON.stringify(assembled.sectionMetadata)]
      );

      await this.updateStatus(correlationId, 'awaiting_review');

      log.info('Phase 2 complete — awaiting editorial review', {
        totalWordCount: writtenNewsletter.totalWordCount,
        subjectLineOptions: subjectLineResult.options.length,
      });

      return this.buildStatus(correlationId, 'awaiting_review', 'awaiting_editor');

    } catch (error: any) {
      log.error('Pipeline Phase 2 failed', { error: error.message });
      await this.updateStatus(correlationId, 'failed');
      return this.buildStatus(correlationId, 'failed', 'failed', [error.message]);
    }
  }

  /**
   * Get current pipeline status.
   */
  async getStatus(correlationId: string): Promise<PipelineRunStatus> {
    const result = await query('SELECT * FROM editions WHERE correlation_id = $1', [correlationId]);
    if (result.rows.length === 0) {
      throw new Error(`Edition not found: ${correlationId}`);
    }
    const row = result.rows[0];
    const statusMap: Record<string, PipelineRunStatus['status']> = {
      discovery: 'running', clustering: 'running', writing: 'running',
      awaiting_selection: 'awaiting_editor', awaiting_review: 'awaiting_editor',
      approved: 'completed', delivered: 'completed', failed: 'failed',
    };
    return {
      correlationId,
      currentStage: row.status,
      status: statusMap[row.status] || 'running',
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      warnings: row.warnings || [],
      costSummary: await this.costTracker.getEditionSummary(correlationId),
    };
  }

  // --- Helper Methods ---

  private async getNextEditionNumber(profileId?: string): Promise<number> {
    if (profileId) {
      const result = await query('SELECT COALESCE(MAX(edition_number), 0) + 1 as next FROM editions WHERE profile_id = $1', [profileId]);
      return result.rows[0].next;
    }
    const result = await query('SELECT COALESCE(MAX(edition_number), 0) + 1 as next FROM editions');
    return result.rows[0].next;
  }

  private async getEditionId(correlationId: string): Promise<string> {
    const result = await query('SELECT id FROM editions WHERE correlation_id = $1', [correlationId]);
    if (result.rows.length === 0) throw new Error(`Edition not found: ${correlationId}`);
    return result.rows[0].id;
  }

  private async getEdition(correlationId: string): Promise<{ editionNumber: number; editionDate: string; newsletterName: string }> {
    const result = await query(
      `SELECT e.edition_number, e.edition_date, np.name as profile_name
       FROM editions e LEFT JOIN newsletter_profiles np ON e.profile_id = np.id
       WHERE e.correlation_id = $1`,
      [correlationId]
    );
    if (result.rows.length === 0) throw new Error(`Edition not found: ${correlationId}`);
    return {
      editionNumber: result.rows[0].edition_number,
      editionDate: result.rows[0].edition_date,
      newsletterName: result.rows[0].profile_name || config.newsletterName,
    };
  }

  private async getTopicConfigs(profileId?: string): Promise<TopicConfig[]> {
    let result;
    if (profileId) {
      result = await query('SELECT * FROM topic_config WHERE profile_id = $1 AND is_active = true ORDER BY priority', [profileId]);
    } else {
      result = await query('SELECT * FROM topic_config WHERE is_active = true ORDER BY priority');
    }
    return result.rows.map((row: any) => ({
      id: row.id, category: row.category, displayName: row.display_name,
      searchQueries: row.search_queries, objective: row.objective,
      preferredSources: row.preferred_sources,
      priority: row.priority, isActive: row.is_active,
      profileId: row.profile_id,
    }));
  }

  private async updateStatus(correlationId: string, status: string): Promise<void> {
    const completedStatuses = ['approved', 'delivered', 'failed'];
    if (completedStatuses.includes(status)) {
      await query('UPDATE editions SET status = $1, completed_at = NOW() WHERE correlation_id = $2', [status, correlationId]);
    } else {
      await query('UPDATE editions SET status = $1 WHERE correlation_id = $2', [status, correlationId]);
    }
  }

  private async recordEditorialAction(editionId: string, actionType: string, data: any): Promise<void> {
    await query(
      'INSERT INTO editorial_actions (edition_id, action_type, action_data) VALUES ($1, $2, $3)',
      [editionId, actionType, JSON.stringify(data)]
    );
  }

  private buildStatus(
    correlationId: string, currentStage: string,
    status: PipelineRunStatus['status'], warnings: string[] = []
  ): PipelineRunStatus {
    return { correlationId, currentStage, status, startedAt: new Date(), warnings };
  }

  private createFailedSection(role: 'lead_story' | 'quick_hit' | 'watch_list', candidate: StoryCandidate) {
    return {
      role, storyCandidateId: candidate.id, headline: `[Failed] ${candidate.headline}`,
      htmlContent: '<p><em>This section failed to generate. Please regenerate or edit manually.</em></p>',
      plainTextContent: '[This section failed to generate]',
      wordCount: 0, sourceLinks: [],
    };
  }
}
