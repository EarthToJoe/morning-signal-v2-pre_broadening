/**
 * Shared utilities for LLM-powered services.
 * Eliminates duplication of cost estimation and JSON parsing across
 * content-researcher, story-writer, and subject-line-generator.
 */

/** Pricing per 1M tokens by model. Update when pricing changes. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-5-nano': { input: 0.05, output: 0.40 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'gpt-5': { input: 1.25, output: 10.00 },
  'gpt-5.1': { input: 1.25, output: 10.00 },
  'gpt-5.2': { input: 1.75, output: 14.00 },
  'gpt-5.4': { input: 1.75, output: 14.00 },
};

/**
 * Estimate the USD cost of an LLM call based on token counts and model.
 */
export function estimateLlmCost(inputTokens: number, outputTokens: number, model: string): number {
  const p = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o-mini'];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/**
 * Defensively parse JSON from an LLM response.
 * Handles raw JSON, markdown-wrapped JSON (```json ... ```), and throws
 * a clear error if no valid JSON is found.
 */
export function parseLlmJson(raw: string): any {
  // 1. Try direct JSON.parse
  try {
    return JSON.parse(raw);
  } catch {
    // 2. Try extracting from markdown code blocks
    const match = raw.match(/```json?\s*([\s\S]*?)```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    throw new Error('No valid JSON found in LLM response');
  }
}
