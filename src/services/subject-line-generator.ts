import OpenAI from 'openai';
import { config } from '../config';
import { createCorrelatedLogger } from '../utils/logger';
import { estimateLlmCost, parseLlmJson } from '../utils/llm-helpers';
import { PromptManagerService } from './prompt-manager';
import { CostTrackerService } from './cost-tracker';
import { WrittenNewsletter, SubjectLineResult } from '../types';

export class SubjectLineGeneratorService {
  private openai: OpenAI;
  private promptManager: PromptManagerService;
  private costTracker: CostTrackerService;

  constructor(promptManager: PromptManagerService, costTracker: CostTrackerService) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.promptManager = promptManager;
    this.costTracker = costTracker;
  }

  /**
   * Generate 3 subject line options in a single LLM call.
   */
  async generateSubjectLines(
    writtenNewsletter: WrittenNewsletter,
    promptOverride: string | null,
    correlationId: string
  ): Promise<SubjectLineResult> {
    const log = createCorrelatedLogger(correlationId, 'subject-line-generator');
    const model = config.llmModels.subjectLineGenerator;

    let promptTemplate: string;
    if (promptOverride) {
      promptTemplate = promptOverride;
    } else {
      const managed = await this.promptManager.getActivePrompt('subject_line_generator');
      promptTemplate = managed.promptText;
    }

    const prompt = this.buildPrompt(promptTemplate, writtenNewsletter);

    log.info('Generating subject lines', { model });
    const startTime = Date.now();

    const response = await this.openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const latency = Date.now() - startTime;
    const usage = response.usage;
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    const cost = estimateLlmCost(inputTokens, outputTokens, model);

    log.info('Subject line generation completed', { model, inputTokens, outputTokens, latencyMs: latency, cost });

    await this.costTracker.record({
      correlationId, stage: 'subject_line_generator', provider: 'openai',
      inputTokens, outputTokens, apiCalls: 1, cost,
    });

    const raw = response.choices[0]?.message?.content || '';
    const parsed = this.parseResponse(raw, log);

    return {
      options: parsed,
      tokenUsage: { input: inputTokens, output: outputTokens },
      cost,
    };
  }

  private buildPrompt(template: string, newsletter: WrittenNewsletter): string {
    const leadHeadline = newsletter.leadStory.headline;
    const firstSentence = newsletter.leadStory.plainTextContent.split('.')[0] + '.';
    const quickHitHeadlines = newsletter.quickHits.map(qh => qh.headline);

    let prompt = template
      .replace('{{leadStory.headline}}', leadHeadline)
      .replace('{{leadStory.firstSentence}}', firstSentence);

    const headlinesBlock = quickHitHeadlines.map(h => `- ${h}`).join('\n');
    prompt = prompt.replace(/\{\{#each quickHitHeadlines\}\}[\s\S]*?\{\{\/each\}\}/g, headlinesBlock);

    return prompt;
  }

  private parseResponse(raw: string, log: any): string[] {
    const parsed = parseLlmJson(raw);

    let options: string[] = parsed.subjectLines || parsed.subject_lines || [];

    // Validate: exactly 3, each <= 50 chars
    options = options.slice(0, 3).map((s: string) => {
      if (s.length > 50) {
        log.warn('Subject line exceeds 50 chars, truncating', { original: s, length: s.length });
        return s.substring(0, 50);
      }
      return s;
    });

    // Pad to 3 if fewer
    while (options.length < 3) {
      options.push(`The Morning Signal — ${new Date().toISOString().split('T')[0]}`);
    }

    return options;
  }
}
