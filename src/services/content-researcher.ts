import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { config } from '../config';
import { createCorrelatedLogger } from '../utils/logger';
import { estimateLlmCost, parseLlmJson } from '../utils/llm-helpers';
import { PromptManagerService } from './prompt-manager';
import { CostTrackerService } from './cost-tracker';
import {
  DiscoveredArticle, StoryCandidate, ClusteringResult, TopicCategory, StoryRole,
} from '../types';

export class ContentResearcherService {
  private openai: OpenAI;
  private promptManager: PromptManagerService;
  private costTracker: CostTrackerService;

  constructor(promptManager: PromptManagerService, costTracker: CostTrackerService) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.promptManager = promptManager;
    this.costTracker = costTracker;
  }

  /**
   * Cluster articles into 8-15 Story_Candidates in a single LLM call.
   */
  async clusterArticles(
    articles: DiscoveredArticle[],
    promptOverride: string | null,
    correlationId: string
  ): Promise<ClusteringResult> {
    const log = createCorrelatedLogger(correlationId, 'content-researcher');

    // Get prompt
    let promptTemplate: string;
    if (promptOverride) {
      promptTemplate = promptOverride;
    } else {
      const managed = await this.promptManager.getActivePrompt('content_researcher');
      promptTemplate = managed.promptText;
    }

    // Build prompt with article data
    const prompt = this.buildPrompt(promptTemplate, articles);

    log.info('Calling LLM for clustering', { articleCount: articles.length, model: config.llmModels.contentResearcher });

    const startTime = Date.now();
    const response = await this.openai.chat.completions.create({
      model: config.llmModels.contentResearcher,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    const latency = Date.now() - startTime;

    const usage = response.usage;
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;

    const cost = estimateLlmCost(inputTokens, outputTokens, config.llmModels.contentResearcher);

    log.info('LLM clustering call completed', {
      model: config.llmModels.contentResearcher,
      inputTokens, outputTokens, latencyMs: latency, cost,
    });

    // Record cost
    await this.costTracker.record({
      correlationId,
      stage: 'content_researcher',
      provider: 'openai',
      inputTokens, outputTokens,
      apiCalls: 1,
      cost,
    });

    // Parse response defensively
    const rawContent = response.choices[0]?.message?.content || '';
    const parsed = this.parseClusteringResponse(rawContent, articles, log);

    return {
      ...parsed,
      tokenUsage: { input: inputTokens, output: outputTokens },
      cost,
    };
  }

  private buildPrompt(template: string, articles: DiscoveredArticle[]): string {
    // Simple Handlebars-style replacement
    let prompt = template
      .replace('{{articleCount}}', String(articles.length))
      .replace('{{currentDate}}', new Date().toISOString().split('T')[0]);

    // Replace articles block
    const articlesBlock = articles.map((a, i) =>
      `[${i}] "${a.title}" — ${a.source} (${a.publishedAt?.toISOString().split('T')[0] || 'unknown'})\n  URL: ${a.url}\n  Category: ${a.category}\n  Snippet: ${a.snippet}`
    ).join('\n\n');

    // Replace the {{#each articles}} block with actual data
    prompt = prompt.replace(/\{\{#each articles\}\}[\s\S]*?\{\{\/each\}\}/g, articlesBlock);

    return prompt;
  }

  private parseClusteringResponse(
    raw: string,
    articles: DiscoveredArticle[],
    log: ReturnType<typeof createCorrelatedLogger>
  ): { storyCandidates: StoryCandidate[]; lowRelevanceArticleIds: string[]; lowRelevanceReasons: Record<string, string> } {
    let parsed: any;

    // Defensive JSON parsing via shared utility
    try {
      parsed = parseLlmJson(raw);
    } catch (err: any) {
      throw new Error('No valid JSON found in LLM clustering response');
    }

    // 2. Validate structure
    if (!Array.isArray(parsed.storyCandidates)) {
      throw new Error('Missing storyCandidates array in LLM response');
    }

    // 3. Map to StoryCandidate objects
    const candidates: StoryCandidate[] = parsed.storyCandidates.slice(0, 15).map((c: any) => {
      const sourceIndices: number[] = Array.isArray(c.sourceArticleIndices) ? c.sourceArticleIndices : [];
      const validIndices = sourceIndices.filter(i => i >= 0 && i < articles.length);
      const sourceArticles = validIndices.map(i => articles[i]);

      return {
        id: uuidv4(),
        suggestedRole: this.validateRole(c.suggestedRole),
        headline: c.headline || 'Untitled Story',
        narrativeSummary: c.narrativeSummary || '',
        sourceArticleIds: sourceArticles.map(a => a.id),
        sourceArticles,
        category: this.validateCategory(c.category),
        isManualStory: false,
      };
    });

    if (candidates.length < 8) {
      log.warn('Fewer than 8 candidates returned by LLM', { count: candidates.length });
    }

    // 4. Parse low-relevance flags
    const lowRelevanceArticleIds: string[] = [];
    const lowRelevanceReasons: Record<string, string> = {};

    if (Array.isArray(parsed.lowRelevanceArticles)) {
      for (const lr of parsed.lowRelevanceArticles) {
        const idx = lr.index;
        if (typeof idx === 'number' && idx >= 0 && idx < articles.length) {
          lowRelevanceArticleIds.push(articles[idx].id);
          lowRelevanceReasons[articles[idx].id] = lr.reason || 'Low relevance';
        }
      }
    }

    return { storyCandidates: candidates, lowRelevanceArticleIds, lowRelevanceReasons };
  }

  private validateRole(role: string): StoryRole {
    const valid: StoryRole[] = ['lead_story', 'quick_hit', 'watch_list'];
    return valid.includes(role as StoryRole) ? (role as StoryRole) : 'quick_hit';
  }

  private validateCategory(category: string): TopicCategory {
    const valid: TopicCategory[] = ['defense', 'energy', 'technology', 'policy'];
    return valid.includes(category as TopicCategory) ? (category as TopicCategory) : 'policy';
  }

}
