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

  /** Write the lead story in a dedicated LLM call. */
  async writeLeadStory(
    candidate: StoryCandidate, promptOverride: string | null, correlationId: string
  ): Promise<WrittenSection> {
    const log = createCorrelatedLogger(correlationId, 'story-writer');
    const model = config.llmModels.storyWriterLead;
    const promptTemplate = promptOverride || (await this.promptManager.getActivePrompt('story_writer_lead')).promptText;
    const prompt = this.buildLeadPrompt(promptTemplate, candidate);

    log.info('Writing lead story', { model, headline: candidate.headline });
    const startTime = Date.now();
    const response = await this.openai.chat.completions.create({
      model, messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }, temperature: 0.5,
    });
    const latency = Date.now() - startTime;
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const cost = estimateLlmCost(inputTokens, outputTokens, model);

    log.info('Lead story LLM call completed', { model, inputTokens, outputTokens, latencyMs: latency, cost });
    await this.costTracker.record({ correlationId, stage: 'story_writer_lead', provider: 'openai', inputTokens, outputTokens, apiCalls: 1, cost });

    return this.parseLeadStoryResponse(response.choices[0]?.message?.content || '', candidate, log);
  }

  /** Write all quick hits in a dedicated LLM call. */
  async writeQuickHits(
    quickHits: StoryCandidate[], promptOverride: string | null, correlationId: string
  ): Promise<WrittenSection[]> {
    if (quickHits.length === 0) return [];
    const log = createCorrelatedLogger(correlationId, 'story-writer');
    const model = config.llmModels.storyWriterBriefings;
    const promptTemplate = promptOverride || (await this.promptManager.getActivePrompt('story_writer_briefings')).promptText;
    const prompt = this.buildQuickHitsPrompt(promptTemplate, quickHits);

    log.info('Writing quick hits', { model, count: quickHits.length });
    const startTime = Date.now();
    const response = await this.openai.chat.completions.create({
      model, messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }, temperature: 0.4,
    });
    const latency = Date.now() - startTime;
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const cost = estimateLlmCost(inputTokens, outputTokens, model);

    log.info('Quick hits LLM call completed', { model, inputTokens, outputTokens, latencyMs: latency, cost });
    await this.costTracker.record({ correlationId, stage: 'story_writer_quick_hits', provider: 'openai', inputTokens, outputTokens, apiCalls: 1, cost });

    const raw = response.choices[0]?.message?.content || '';
    const parsed = parseLlmJson(raw);
    return (parsed.quickHits || []).map((qh: any, i: number) => ({
      role: 'quick_hit' as StoryRole,
      storyCandidateId: quickHits[i]?.id || '',
      headline: qh.headline || '',
      htmlContent: qh.htmlContent || '',
      plainTextContent: qh.plainTextContent || '',
      wordCount: this.countWords(qh.plainTextContent || qh.htmlContent || ''),
      sourceLinks: Array.isArray(qh.sourceLinks) ? qh.sourceLinks : [],
    }));
  }

  /** Write all watch list items in a dedicated LLM call. */
  async writeWatchList(
    watchListItems: StoryCandidate[], promptOverride: string | null, correlationId: string
  ): Promise<WrittenSection[]> {
    if (watchListItems.length === 0) return [];
    const log = createCorrelatedLogger(correlationId, 'story-writer');
    const model = config.llmModels.storyWriterBriefings;
    const promptTemplate = promptOverride || (await this.promptManager.getActivePrompt('story_writer_watch_list')).promptText;
    const prompt = this.buildWatchListPrompt(promptTemplate, watchListItems);

    log.info('Writing watch list', { model, count: watchListItems.length });
    const startTime = Date.now();
    const response = await this.openai.chat.completions.create({
      model, messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }, temperature: 0.4,
    });
    const latency = Date.now() - startTime;
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const cost = estimateLlmCost(inputTokens, outputTokens, model);

    log.info('Watch list LLM call completed', { model, inputTokens, outputTokens, latencyMs: latency, cost });
    await this.costTracker.record({ correlationId, stage: 'story_writer_watch_list', provider: 'openai', inputTokens, outputTokens, apiCalls: 1, cost });

    const raw = response.choices[0]?.message?.content || '';
    const parsed = parseLlmJson(raw);
    return (parsed.watchList || []).map((wl: any, i: number) => ({
      role: 'watch_list' as StoryRole,
      storyCandidateId: watchListItems[i]?.id || '',
      headline: wl.headline || '',
      htmlContent: wl.htmlContent || '',
      plainTextContent: wl.plainTextContent || '',
      wordCount: this.countWords(wl.plainTextContent || wl.htmlContent || ''),
      sourceLinks: [],
    }));
  }

  /** Backward-compatible writeBriefings — calls writeQuickHits + writeWatchList in parallel. */
  async writeBriefings(
    quickHits: StoryCandidate[], watchListItems: StoryCandidate[],
    promptOverride: string | null, correlationId: string
  ): Promise<{ quickHits: WrittenSection[]; watchList: WrittenSection[] }> {
    const [qhResults, wlResults] = await Promise.all([
      this.writeQuickHits(quickHits, promptOverride, correlationId),
      this.writeWatchList(watchListItems, promptOverride, correlationId),
    ]);
    return { quickHits: qhResults, watchList: wlResults };
  }

  /** Regenerate a single section. */
  async regenerateSection(
    section: WrittenSection, candidate: StoryCandidate,
    promptOverride: string | null, correlationId: string
  ): Promise<WrittenSection> {
    if (section.role === 'lead_story') return this.writeLeadStory(candidate, promptOverride, correlationId);
    if (section.role === 'quick_hit') {
      const results = await this.writeQuickHits([candidate], promptOverride, correlationId);
      return results[0] || section;
    }
    const results = await this.writeWatchList([candidate], promptOverride, correlationId);
    return results[0] || section;
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

  private buildQuickHitsPrompt(template: string, quickHits: StoryCandidate[]): string {
    const currentDate = new Date().toISOString().split('T')[0];
    const qhBlock = quickHits.map((qh, i) => {
      const sources = qh.sourceArticles.map(a => `  - "${a.title}" — ${a.source}: ${a.url}\n    Snippet: ${a.snippet.substring(0, 500)}`).join('\n');
      return `--- Quick Hit ${i + 1} ---\nHeadline: ${qh.headline}\nSummary: ${qh.narrativeSummary}\nSources:\n${sources}`;
    }).join('\n\n');

    return `You are a briefing writer for ${config.newsletterName}, a professional newsletter.

TASK: Write ${quickHits.length} quick-hit briefing items. Give each one your full attention.

${qhBlock}

TODAY'S DATE: ${currentDate}

REQUIREMENTS PER QUICK HIT:
- MINIMUM 120 words, target 150 words. DO NOT write fewer than 120 words per item.
- A punchy, specific headline
- A concise but informative summary covering the key facts: who, what, when, and why it matters
- At least one inline hyperlink to a source article using HTML <a> tags
- Professional tone suitable for busy executives
- These are stories about things that ALREADY HAPPENED

OUTPUT FORMAT (strict JSON):
{
  "quickHits": [
    {
      "headline": "string",
      "htmlContent": "string — HTML with <a> tags",
      "plainTextContent": "string",
      "sourceLinks": [{ "url": "string", "anchorText": "string" }]
    }
  ]
}`;
  }

  private buildWatchListPrompt(template: string, watchListItems: StoryCandidate[]): string {
    const currentDate = new Date().toISOString().split('T')[0];
    const wlBlock = watchListItems.map((wl, i) => {
      const sources = wl.sourceArticles.map(a => `  - "${a.title}" — ${a.source}: ${a.url}\n    Snippet: ${a.snippet.substring(0, 500)}`).join('\n');
      return `--- Watch Item ${i + 1} ---\nHeadline: ${wl.headline}\nSummary: ${wl.narrativeSummary}\nSources:\n${sources}`;
    }).join('\n\n');

    return `You are a forward-looking analyst for ${config.newsletterName}, a professional newsletter.

TASK: Write ${watchListItems.length} watch list items. These are FORWARD-LOOKING — about things that HAVE NOT happened yet.

${wlBlock}

TODAY'S DATE: ${currentDate}

REQUIREMENTS PER WATCH LIST ITEM:
- MINIMUM 80 words, target 100 words. DO NOT write fewer than 80 words per item.
- These are about upcoming decisions, pending legislation, scheduled events, or developing situations to monitor
- This is what makes the watch list different from quick hits: quick hits report news that happened, watch list flags what is COMING NEXT
- Include a specific date or timeframe (e.g., "Week of March 15", "Q2 2026", "expected by summer")
- Explain what is expected to happen and why the reader should care
- Reference source material where applicable using HTML <a> tags

OUTPUT FORMAT (strict JSON):
{
  "watchList": [
    {
      "headline": "string",
      "timeframe": "string — specific date or period",
      "htmlContent": "string — HTML with <a> tags",
      "plainTextContent": "string"
    }
  ]
}`;
  }

  private countWords(text: string): number {
    return text.replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(w => w.length > 0).length;
  }

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
}
