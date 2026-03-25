import OpenAI from 'openai';
import { config } from '../config';
import { createCorrelatedLogger } from '../utils/logger';
import { estimateLlmCost, parseLlmJson } from '../utils/llm-helpers';
import { PromptManagerService } from './prompt-manager';
import { CostTrackerService } from './cost-tracker';
import { StoryCandidate, WrittenSection, WrittenNewsletter, StoryRole } from '../types';

export class StoryWriterService {
  private openai: OpenAI;
  private promptManager: PromptManagerService;
  private costTracker: CostTrackerService;

  constructor(promptManager: PromptManagerService, costTracker: CostTrackerService) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.promptManager = promptManager;
    this.costTracker = costTracker;
  }

  /**
   * Write the lead story in a dedicated LLM call.
   */
  async writeLeadStory(
    candidate: StoryCandidate,
    promptOverride: string | null,
    correlationId: string
  ): Promise<WrittenSection> {
    const log = createCorrelatedLogger(correlationId, 'story-writer');
    const model = config.llmModels.storyWriterLead;

    let promptTemplate: string;
    if (promptOverride) {
      promptTemplate = promptOverride;
    } else {
      const managed = await this.promptManager.getActivePrompt('story_writer_lead');
      promptTemplate = managed.promptText;
    }

    const prompt = this.buildLeadPrompt(promptTemplate, candidate);

    log.info('Writing lead story', { model, headline: candidate.headline });
    const startTime = Date.now();

    const response = await this.openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.5,
    });

    const latency = Date.now() - startTime;
    const usage = response.usage;
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    const cost = estimateLlmCost(inputTokens, outputTokens, model);

    log.info('Lead story LLM call completed', { model, inputTokens, outputTokens, latencyMs: latency, cost });

    await this.costTracker.record({
      correlationId, stage: 'story_writer_lead', provider: 'openai',
      inputTokens, outputTokens, apiCalls: 1, cost,
    });

    const raw = response.choices[0]?.message?.content || '';
    return this.parseLeadStoryResponse(raw, candidate, log);
  }

  /**
   * Write quick hits + watch list in a single LLM call.
   */
  async writeBriefings(
    quickHits: StoryCandidate[],
    watchListItems: StoryCandidate[],
    promptOverride: string | null,
    correlationId: string
  ): Promise<{ quickHits: WrittenSection[]; watchList: WrittenSection[] }> {
    const log = createCorrelatedLogger(correlationId, 'story-writer');
    const model = config.llmModels.storyWriterBriefings;

    let promptTemplate: string;
    if (promptOverride) {
      promptTemplate = promptOverride;
    } else {
      const managed = await this.promptManager.getActivePrompt('story_writer_briefings');
      promptTemplate = managed.promptText;
    }

    const prompt = this.buildBriefingsPrompt(promptTemplate, quickHits, watchListItems);

    log.info('Writing briefings', { model, quickHitCount: quickHits.length, watchListCount: watchListItems.length });
    const startTime = Date.now();

    const response = await this.openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    });

    const latency = Date.now() - startTime;
    const usage = response.usage;
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    const cost = estimateLlmCost(inputTokens, outputTokens, model);

    log.info('Briefings LLM call completed', { model, inputTokens, outputTokens, latencyMs: latency, cost });

    await this.costTracker.record({
      correlationId, stage: 'story_writer_briefings', provider: 'openai',
      inputTokens, outputTokens, apiCalls: 1, cost,
    });

    const raw = response.choices[0]?.message?.content || '';
    return this.parseBriefingsResponse(raw, quickHits, watchListItems, log);
  }

  /**
   * Regenerate a single section.
   */
  async regenerateSection(
    section: WrittenSection,
    candidate: StoryCandidate,
    promptOverride: string | null,
    correlationId: string
  ): Promise<WrittenSection> {
    if (section.role === 'lead_story') {
      return this.writeLeadStory(candidate, promptOverride, correlationId);
    }
    // For quick_hit or watch_list, re-run briefings for just this one
    const log = createCorrelatedLogger(correlationId, 'story-writer');
    const model = config.llmModels.storyWriterBriefings;

    const managed = await this.promptManager.getActivePrompt('story_writer_briefings');
    const prompt = section.role === 'quick_hit'
      ? this.buildBriefingsPrompt(promptOverride || managed.promptText, [candidate], [])
      : this.buildBriefingsPrompt(promptOverride || managed.promptText, [], [candidate]);

    const response = await this.openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    });

    const usage = response.usage;
    const cost = estimateLlmCost(usage?.prompt_tokens || 0, usage?.completion_tokens || 0, model);

    await this.costTracker.record({
      correlationId, stage: 'story_writer_briefings', provider: 'openai',
      inputTokens: usage?.prompt_tokens || 0, outputTokens: usage?.completion_tokens || 0,
      apiCalls: 1, cost,
    });

    const raw = response.choices[0]?.message?.content || '';
    const parsed = this.parseBriefingsResponse(raw, section.role === 'quick_hit' ? [candidate] : [], section.role === 'watch_list' ? [candidate] : [], log);

    if (section.role === 'quick_hit' && parsed.quickHits.length > 0) return parsed.quickHits[0];
    if (section.role === 'watch_list' && parsed.watchList.length > 0) return parsed.watchList[0];
    return section; // Fallback: return original if parsing fails
  }

  // --- Prompt Building ---

  private buildLeadPrompt(template: string, candidate: StoryCandidate): string {
    let prompt = template
      .replace('{{candidate.headline}}', candidate.headline)
      .replace('{{candidate.narrativeSummary}}', candidate.narrativeSummary);

    const articlesBlock = candidate.sourceArticles.map((a, i) =>
      `[${i}] "${a.title}" — ${a.source} (${a.publishedAt?.toISOString().split('T')[0] || 'unknown'})\n  URL: ${a.url}\n  Snippet: ${a.snippet}`
    ).join('\n\n');

    prompt = prompt.replace(/\{\{#each sourceArticles\}\}[\s\S]*?\{\{\/each\}\}/g, articlesBlock);
    return prompt;
  }

  private buildBriefingsPrompt(template: string, quickHits: StoryCandidate[], watchListItems: StoryCandidate[]): string {
    let prompt = template.replace('{{currentDate}}', new Date().toISOString().split('T')[0]);

    // Quick hits block
    const qhBlock = quickHits.map((qh, i) => {
      const sources = qh.sourceArticles.map(a => `  - "${a.title}" — ${a.source}: ${a.url}`).join('\n');
      return `--- Quick Hit ${i} ---\nHeadline: ${qh.headline}\nSummary: ${qh.narrativeSummary}\nSources:\n${sources}`;
    }).join('\n\n');

    // Watch list block
    const wlBlock = watchListItems.map((wl, i) => {
      const sources = wl.sourceArticles.map(a => `  - "${a.title}" — ${a.source}: ${a.url}`).join('\n');
      return `--- Watch Item ${i} ---\nHeadline: ${wl.headline}\nSummary: ${wl.narrativeSummary}\nSources:\n${sources}`;
    }).join('\n\n');

    prompt = prompt.replace(/\{\{#each quickHits\}\}[\s\S]*?\{\{\/each\}\}/g, qhBlock);
    prompt = prompt.replace(/\{\{#each watchListItems\}\}[\s\S]*?\{\{\/each\}\}/g, wlBlock);

    return prompt;
  }

  // --- Response Parsing ---

  private parseLeadStoryResponse(raw: string, candidate: StoryCandidate, log: any): WrittenSection {
    const parsed = parseLlmJson(raw);

    return {
      role: 'lead_story',
      storyCandidateId: candidate.id,
      headline: parsed.headline || candidate.headline,
      htmlContent: parsed.htmlContent || '',
      plainTextContent: parsed.plainTextContent || '',
      wordCount: this.countWords(parsed.plainTextContent || parsed.htmlContent || ''),
      sourceLinks: Array.isArray(parsed.sourceLinks) ? parsed.sourceLinks : [],
    };
  }

  private parseBriefingsResponse(
    raw: string,
    quickHitCandidates: StoryCandidate[],
    watchListCandidates: StoryCandidate[],
    log: any
  ): { quickHits: WrittenSection[]; watchList: WrittenSection[] } {
    const parsed = parseLlmJson(raw);

    const quickHits: WrittenSection[] = (parsed.quickHits || []).map((qh: any, i: number) => ({
      role: 'quick_hit' as StoryRole,
      storyCandidateId: quickHitCandidates[i]?.id || '',
      headline: qh.headline || '',
      htmlContent: qh.htmlContent || '',
      plainTextContent: qh.plainTextContent || '',
      wordCount: this.countWords(qh.plainTextContent || qh.htmlContent || ''),
      sourceLinks: Array.isArray(qh.sourceLinks) ? qh.sourceLinks : [],
    }));

    const watchList: WrittenSection[] = (parsed.watchList || []).map((wl: any, i: number) => ({
      role: 'watch_list' as StoryRole,
      storyCandidateId: watchListCandidates[i]?.id || '',
      headline: wl.headline || '',
      htmlContent: wl.htmlContent || '',
      plainTextContent: wl.plainTextContent || '',
      wordCount: this.countWords(wl.plainTextContent || wl.htmlContent || ''),
      sourceLinks: [],
    }));

    return { quickHits, watchList };
  }

  private countWords(text: string): number {
    return text.replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(w => w.length > 0).length;
  }
}
