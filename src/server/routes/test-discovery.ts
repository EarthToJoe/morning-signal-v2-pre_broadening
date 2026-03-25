/**
 * Test routes for Parallel AI article discovery.
 * Exposes the FULL request payload sent to Parallel AI so you can see and tune every input.
 *
 * POST /api/test/search   → Run a search with full control over all inputs, returns request + response
 * POST /api/test/discover → Run full discovery across categories, returns per-category request payloads + results
 */
import { Router, Request, Response } from 'express';
import { config } from '../../config';
import { TopicCategory } from '../../types';

const router = Router();

/** The exact shape we send to Parallel AI */
interface ParallelAiRequest {
  objective: string;
  search_queries: string[];
  max_results: number;
  excerpts: { max_chars_per_result: number; max_chars_total: number };
  source_policy?: { after_date?: string; exclude_domains?: string[] };
  fetch_policy?: { max_age_seconds: number };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

/** Call Parallel AI and return both the request payload and raw response */
async function callParallelAi(payload: ParallelAiRequest) {
  const response = await fetch('https://api.parallel.ai/v1beta/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.parallelAiApiKey },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Parallel AI ${response.status}: ${body}`);
  }
  return await response.json() as any;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Default objectives per category (what we use in production)
const CATEGORY_OBJECTIVES: Record<string, string> = {
  defense: `Find specific, individual news articles published in the last few days. I need articles with unique URLs that point to individual stories — NOT website homepages, section landing pages, company LinkedIn profiles, or topic index pages. Each result should be a single news story or report with a specific headline, author or publication date, and substantive content. Prefer articles from established news outlets. Topic: U.S. and allied defense developments including military contracts, weapons programs, force posture changes, Pentagon policy, NATO operations, defense industry news, and military technology. Preferred sources: Defense News, Breaking Defense, Defense One, Military Times, Stars and Stripes, Reuters, AP, USNI News.`,
  energy: `Find specific, individual news articles published in the last few days. I need articles with unique URLs that point to individual stories — NOT website homepages, section landing pages, company LinkedIn profiles, or topic index pages. Each result should be a single news story or report with a specific headline, author or publication date, and substantive content. Prefer articles from established news outlets. Topic: Energy sector developments including oil & gas markets, renewable energy projects, grid infrastructure, nuclear energy policy, energy legislation, utility company news, and energy technology. Preferred sources: E&E News, Utility Dive, Reuters, Bloomberg Energy, S&P Global, Rigzone.`,
  technology: `Find specific, individual news articles published in the last few days. I need articles with unique URLs that point to individual stories — NOT website homepages, section landing pages, company LinkedIn profiles, or topic index pages. Each result should be a single news story or report with a specific headline, author or publication date, and substantive content. Prefer articles from established news outlets. Topic: Technology developments relevant to government and enterprise including cybersecurity incidents, AI policy and regulation, cloud computing contracts, semiconductor supply chain, space technology, and federal IT modernization. Preferred sources: Ars Technica, The Verge, Wired, Federal News Network, NextGov, CyberScoop.`,
  policy: `Find specific, individual news articles published in the last few days. I need articles with unique URLs that point to individual stories — NOT website homepages, section landing pages, company LinkedIn profiles, or topic index pages. Each result should be a single news story or report with a specific headline, author or publication date, and substantive content. Prefer articles from established news outlets. Topic: U.S. government policy affecting defense, energy, and technology sectors including executive orders, congressional legislation, regulatory actions, budget decisions, and agency leadership changes. Preferred sources: Politico, The Hill, Reuters, AP, Federal News Network, Roll Call.`,
  custom: `Find specific, individual news articles published in the last few days. Return individual stories with unique URLs — NOT website homepages, section landing pages, or company profiles. Each result should be a single news story with a specific headline and substantive content.`,
};

const DEFAULT_SEARCH_QUERIES: Record<string, string[]> = {
  defense: ['US defense contracts military awards 2026', 'Pentagon defense policy military technology', 'NATO allied defense operations'],
  energy: ['US energy policy oil gas renewable 2026', 'nuclear energy grid infrastructure', 'energy technology innovation utility'],
  technology: ['cybersecurity incidents AI regulation 2026', 'federal IT modernization cloud computing', 'semiconductor supply chain space technology'],
  policy: ['US government executive orders legislation 2026', 'defense energy technology budget policy', 'federal agency regulatory actions'],
};

const DEFAULT_EXCLUDE_DOMAINS = ['linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com'];

// GET /api/test/defaults — Return all default inputs so the UI can pre-populate
router.get('/defaults', (_req: Request, res: Response) => {
  res.json({
    objectives: CATEGORY_OBJECTIVES,
    searchQueries: DEFAULT_SEARCH_QUERIES,
    excludeDomains: DEFAULT_EXCLUDE_DOMAINS,
    maxResults: 10,
    excerpts: { max_chars_per_result: 10000, max_chars_total: 50000 },
    afterDateDays: 3,
    fetchPolicyMaxAge: 172800,
  });
});

// POST /api/test/search — Run a single search with full input control
// Body can override any field. Returns the exact request payload + results.
router.post('/search', async (req: Request, res: Response) => {
  try {
    const {
      objective,
      searchQueries,
      maxResults = 10,
      afterDate,
      afterDateDays = 7,
      excludeDomains = DEFAULT_EXCLUDE_DOMAINS,
      excerpts = { max_chars_per_result: 10000, max_chars_total: 50000 },
      fetchPolicyMaxAge = 172800,
      category = 'custom',
    } = req.body;

    if (!objective && !searchQueries) {
      return res.status(400).json({ error: 'Provide at least objective or searchQueries' });
    }

    const resolvedObjective = objective || CATEGORY_OBJECTIVES[category] || CATEGORY_OBJECTIVES.custom;
    const resolvedQueries = searchQueries || [];
    const resolvedAfterDate = afterDate || daysAgo(afterDateDays);

    // Build the exact payload we send to Parallel AI
    const payload: ParallelAiRequest = {
      objective: resolvedObjective,
      search_queries: resolvedQueries,
      max_results: maxResults,
      excerpts,
      fetch_policy: { max_age_seconds: fetchPolicyMaxAge },
    };

    // Only add source_policy if we have filters
    if (resolvedAfterDate || (excludeDomains && excludeDomains.length > 0)) {
      payload.source_policy = {};
      if (resolvedAfterDate) payload.source_policy.after_date = resolvedAfterDate;
      if (excludeDomains && excludeDomains.length > 0) payload.source_policy.exclude_domains = excludeDomains;
    }

    const startTime = Date.now();
    const rawResponse = await callParallelAi(payload);
    const elapsed = Date.now() - startTime;

    // Map results
    const results = (rawResponse.results || []).map((r: any, i: number) => ({
      title: r.title || '',
      url: r.url || '',
      source: extractDomain(r.url),
      publishDate: r.publish_date || null,
      rankPosition: i,
      excerptCount: (r.excerpts || []).length,
      excerptTotalChars: (r.excerpts || []).reduce((s: number, e: string) => s + e.length, 0),
      excerpts: r.excerpts || [],
    }));

    // Quality check
    let homepageCount = 0;
    for (const r of results) {
      try { if (new URL(r.url).pathname === '/' || new URL(r.url).pathname === '') homepageCount++; } catch {}
    }

    res.json({
      // The exact request we sent — this is what you tune
      request: payload,
      // Metadata
      meta: {
        searchId: rawResponse.search_id,
        elapsedMs: elapsed,
        resultCount: results.length,
        usage: rawResponse.usage,
        warnings: rawResponse.warnings,
        homepageCount,
        qualityScore: results.length > 0 ? Math.round(((results.length - homepageCount) / results.length) * 100) : 0,
      },
      // The results
      results,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/test/discover — Run full discovery across selected categories
// Returns per-category request payloads so you can see exactly what was sent for each
router.post('/discover', async (req: Request, res: Response) => {
  try {
    const categories: string[] = req.body?.categories || ['defense', 'energy', 'technology', 'policy'];
    const afterDate = daysAgo(req.body?.afterDateDays || 3);
    const excludeDomains = req.body?.excludeDomains || DEFAULT_EXCLUDE_DOMAINS;
    const maxResults = req.body?.maxResults || 10;
    const excerpts = req.body?.excerpts || { max_chars_per_result: 10000, max_chars_total: 50000 };

    const categoryResults: Record<string, any> = {};
    const startTime = Date.now();
    let totalArticles = 0;

    for (const cat of categories) {
      const objective = req.body?.objectives?.[cat] || CATEGORY_OBJECTIVES[cat] || CATEGORY_OBJECTIVES.custom;
      const queries = req.body?.searchQueries?.[cat] || DEFAULT_SEARCH_QUERIES[cat] || [];

      const payload: ParallelAiRequest = {
        objective,
        search_queries: queries,
        max_results: maxResults,
        excerpts,
        fetch_policy: { max_age_seconds: 172800 },
      };
      if (afterDate || excludeDomains.length > 0) {
        payload.source_policy = {};
        if (afterDate) payload.source_policy.after_date = afterDate;
        if (excludeDomains.length > 0) payload.source_policy.exclude_domains = excludeDomains;
      }

      try {
        const catStart = Date.now();
        const rawResponse = await callParallelAi(payload);
        const catElapsed = Date.now() - catStart;

        const results = (rawResponse.results || []).map((r: any, i: number) => ({
          title: r.title || '',
          url: r.url || '',
          source: extractDomain(r.url),
          publishDate: r.publish_date || null,
          rankPosition: i,
          excerptCount: (r.excerpts || []).length,
          excerptTotalChars: (r.excerpts || []).reduce((s: number, e: string) => s + e.length, 0),
          excerpts: r.excerpts || [],
        }));

        totalArticles += results.length;
        categoryResults[cat] = { request: payload, elapsedMs: catElapsed, resultCount: results.length, results };
      } catch (err: any) {
        categoryResults[cat] = { request: payload, error: err.message, results: [] };
      }
    }

    res.json({
      summary: { totalArticles, categories: categories.length, elapsedMs: Date.now() - startTime },
      categories: categoryResults,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as testDiscoveryRouter };
