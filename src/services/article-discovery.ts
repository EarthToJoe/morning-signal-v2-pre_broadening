import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { createCorrelatedLogger } from '../utils/logger';
import { CostTrackerService } from './cost-tracker';
import {
  DiscoveredArticle, ArticleDiscoveryResult, RawSearchResult,
  TopicCategory, TopicConfig, DiscoverySource,
} from '../types';

// --- Parallel AI Client ---

/** Raw shape returned by Parallel AI Search API */
interface ParallelAiResult {
  url: string;
  title: string;
  publish_date: string | null;
  excerpts: string[];
}

interface ParallelAiResponse {
  search_id: string;
  results: ParallelAiResult[];
  warnings: string | null;
  usage: { name: string; count: number }[];
}

/** Options for a Parallel AI search call */
interface SearchOptions {
  /** Natural language description of the research goal — tells Parallel AI what kind
   *  of content to find. This is the primary driver of result quality. */
  objective: string;
  /** Specific keyword queries to supplement the objective. */
  searchQueries: string[];
  maxResults: number;
  /** Only return content published on or after this date (YYYY-MM-DD). */
  afterDate?: string;
  /** Domains to exclude from results (e.g., linkedin.com). Max 10. */
  excludeDomains?: string[];
}

export class ParallelAiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Search Parallel AI using objective + search_queries (recommended approach).
   *
   * The key insight from Parallel AI docs: use `objective` for natural language context
   * about what you're looking for, and `search_queries` for specific keywords. Together
   * they produce much more targeted results than a bare query string alone.
   *
   * We also use `source_policy.after_date` for freshness and `fetch_policy` to prefer
   * recently indexed content — this prevents generic homepage results.
   */
  async search(options: SearchOptions): Promise<RawSearchResult[]> {
    const body: Record<string, any> = {
      objective: options.objective,
      search_queries: options.searchQueries,
      max_results: options.maxResults,
      // Max out excerpt sizes — these feed directly into GPT prompts for story writing.
      // Parallel AI supports up to 10K per result and 50K total.
      excerpts: { max_chars_per_result: 10000, max_chars_total: 50000 },
      // Prefer fresh content from the index (within last 2 days)
      fetch_policy: { max_age_seconds: 172800 },
    };

    // Freshness filter: only return content published after this date
    if (options.afterDate) {
      body.source_policy = {
        after_date: options.afterDate,
        // Exclude domains that tend to return homepages/profiles instead of articles
        ...(options.excludeDomains ? { exclude_domains: options.excludeDomains } : {}),
      };
    } else if (options.excludeDomains) {
      body.source_policy = { exclude_domains: options.excludeDomains };
    }

    const response = await fetch('https://api.parallel.ai/v1beta/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Parallel AI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as ParallelAiResponse;

    // Map Parallel AI results to our normalized format
    const results: RawSearchResult[] = (data.results || []).map((item, index) => ({
      url: item.url || '',
      title: item.title || '',
      snippet: this.joinExcerpts(item.excerpts || []),
      source: this.extractDomain(item.url),
      publishedDate: item.publish_date || undefined,
      rankPosition: index,
    }));

    return results;
  }

  /** Combine excerpts into a usable snippet. Parallel AI returns extended, LLM-optimized
   *  content chunks — we join them all since they feed directly into GPT prompts. */
  private joinExcerpts(excerpts: string[]): string {
    if (excerpts.length === 0) return '';
    return excerpts.join('\n\n').trim();
  }

  /** Extract a clean domain name from a URL. */
  private extractDomain(url: string): string {
    try {
      const hostname = new URL(url).hostname;
      return hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }
}

// --- Article Discovery Service ---

/** Compute a date string N days ago in YYYY-MM-DD format */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

/** Build a natural-language objective for a topic category.
 *  If the TopicConfig has a custom `objective` field, use it.
 *  Otherwise fall back to the hardcoded Morning Signal defaults.
 *  The base boilerplate about "specific articles, not homepages" is always prepended. */
function buildObjective(topic: TopicConfig): string {
  const base = `Find specific, individual news articles published in the last few days. I need articles with unique URLs that point to individual stories — NOT website homepages, section landing pages, company LinkedIn profiles, or topic index pages. Each result should be a single news story or report with a specific headline, author or publication date, and substantive content. Prefer articles from established news outlets.`;

  // If the topic config has a custom objective, use it (prepend "Topic:" automatically)
  if ((topic as any).objective) {
    const userObjective = (topic as any).objective;
    // Don't double-add "Topic:" if the user already included it
    const topicPart = userObjective.toLowerCase().startsWith('topic:') ? userObjective : `Topic: ${userObjective}`;
    return `${base} ${topicPart}`;
  }

  // Fallback: hardcoded Morning Signal defaults
  const defaults: Record<string, string> = {
    defense: `U.S. and allied defense developments including military contracts, weapons programs, force posture changes, Pentagon policy, NATO operations, defense industry news, and military technology. Preferred sources: Defense News, Breaking Defense, Defense One, Military Times, Stars and Stripes, Reuters, AP, USNI News.`,
    energy: `Energy sector developments including oil & gas markets, renewable energy projects, grid infrastructure, nuclear energy policy, energy legislation, utility company news, and energy technology. Preferred sources: E&E News, Utility Dive, Reuters, Bloomberg Energy, S&P Global, Rigzone.`,
    technology: `Technology developments relevant to government and enterprise including cybersecurity incidents, AI policy and regulation, cloud computing contracts, semiconductor supply chain, space technology, and federal IT modernization. Preferred sources: Ars Technica, The Verge, Wired, Federal News Network, NextGov, CyberScoop.`,
    policy: `U.S. government policy affecting defense, energy, and technology sectors including executive orders, congressional legislation, regulatory actions, budget decisions, and agency leadership changes. Preferred sources: Politico, The Hill, Reuters, AP, Federal News Network, Roll Call.`,
  };

  const categoryPart = defaults[topic.category] || `${topic.displayName}. Search for recent news and developments.`;
  return `${base} Topic: ${categoryPart}`;
}

export class ArticleDiscoveryService {
  private searchClient: ParallelAiClient;
  private costTracker: CostTrackerService;

  constructor(searchClient: ParallelAiClient, costTracker: CostTrackerService) {
    this.searchClient = searchClient;
    this.costTracker = costTracker;
  }

  /**
   * Execute discovery for all configured topic categories.
   *
   * For each category, we make ONE Parallel AI call using:
   * - `objective`: natural language description of what we want (specific articles, not homepages)
   * - `search_queries`: all the keyword queries for that category combined
   * - `source_policy.after_date`: only content from the last 3 days
   * - `fetch_policy.max_age_seconds`: prefer recently indexed content
   *
   * This replaces the old approach of one call per query string, which was producing
   * generic homepage results because it lacked the objective context.
   */
  async discoverArticles(topicConfigs: TopicConfig[], correlationId: string, daysBack?: number): Promise<ArticleDiscoveryResult> {
    const log = createCorrelatedLogger(correlationId, 'article-discovery');
    const allArticles: DiscoveredArticle[] = [];
    const warnings: string[] = [];
    let searchApiCalls = 0;
    let totalCost = 0;
    const categoryCoverage: Record<string, number> = {};
    for (const topic of topicConfigs.filter(t => t.isActive)) {
      categoryCoverage[topic.category] = 0;
    }

    const afterDate = daysAgo(daysBack || 3);
    const excludeDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com'];

    for (const topic of topicConfigs.filter(t => t.isActive)) {
      try {
        const startTime = Date.now();
        const results = await this.searchClient.search({
          objective: buildObjective(topic),
          searchQueries: topic.searchQueries,
          maxResults: 15,
          afterDate,
          excludeDomains,
        });
        const latency = Date.now() - startTime;
        searchApiCalls++;

        log.info('Search API call completed', {
          category: topic.category,
          queryCount: topic.searchQueries.length,
          resultCount: results.length,
          latencyMs: latency,
        });

        for (const raw of results) {
          const article = this.validateArticle(raw, topic.category, 'search_api');
          if (article) {
            allArticles.push(article);
            categoryCoverage[topic.category]++;
          }
        }
      } catch (error: any) {
        log.error('Search API call failed', { category: topic.category, error: error.message });
        warnings.push(`Search failed for ${topic.category}: ${error.message}`);
      }
    }

    // Deduplicate by exact URL
    const deduplicated = this.deduplicateArticles(allArticles);
    const duplicatesRemoved = allArticles.length - deduplicated.length;

    // Low-coverage warning
    if (deduplicated.length < 10) {
      warnings.push(`Low coverage: only ${deduplicated.length} articles found across all categories`);
    }

    // Record search API cost (Parallel AI bills per SKU; estimate ~$0.01 per call)
    const estimatedCostPerCall = 0.01;
    totalCost = searchApiCalls * estimatedCostPerCall;

    await this.costTracker.record({
      correlationId,
      stage: 'article_discovery',
      provider: 'parallel-ai',
      apiCalls: searchApiCalls,
      cost: totalCost,
    });

    log.info('Article discovery completed', {
      totalFound: deduplicated.length, duplicatesRemoved, searchApiCalls, warnings,
    });

    return {
      articles: deduplicated,
      totalFound: deduplicated.length,
      duplicatesRemoved,
      categoryCoverage,
      searchApiCalls,
      warnings,
    };
  }

  /**
   * Execute a custom editor-initiated search and merge with existing articles.
   */
  async customSearch(
    queryText: string,
    existingArticles: DiscoveredArticle[],
    correlationId: string
  ): Promise<ArticleDiscoveryResult> {
    const log = createCorrelatedLogger(correlationId, 'article-discovery');

    try {
      const results = await this.searchClient.search({
        objective: `Find specific, recently published news articles about the following topic. Return individual stories with concrete details, not website homepages or landing pages.`,
        searchQueries: [queryText],
        maxResults: 15,
        afterDate: daysAgo(7), // Custom searches look back a week
      });
      const newArticles: DiscoveredArticle[] = [];

      for (const raw of results) {
        const article = this.validateArticle(raw, 'general', 'custom_search');
        if (article) {
          newArticles.push(article);
        }
      }

      // Merge and deduplicate
      const merged = [...existingArticles, ...newArticles];
      const deduplicated = this.deduplicateArticles(merged);
      const duplicatesRemoved = merged.length - deduplicated.length;

      // Record cost
      await this.costTracker.record({
        correlationId,
        stage: 'custom_search',
        provider: 'parallel-ai',
        apiCalls: 1,
        cost: 0.01,
      });

      log.info('Custom search completed', { query: queryText, newArticles: newArticles.length, duplicatesRemoved });

      const categoryCoverage: Record<string, number> = {};
      for (const a of deduplicated) {
        categoryCoverage[a.category] = (categoryCoverage[a.category] || 0) + 1;
      }

      return {
        articles: deduplicated,
        totalFound: deduplicated.length,
        duplicatesRemoved,
        categoryCoverage,
        searchApiCalls: 1,
        warnings: deduplicated.length < 10 ? [`Low coverage: only ${deduplicated.length} articles`] : [],
      };
    } catch (error: any) {
      log.error('Custom search failed', { query: queryText, error: error.message });
      throw error;
    }
  }

  /**
   * Validate a raw search result: must have URL and title.
   */
  validateArticle(raw: RawSearchResult, category: TopicCategory, source: DiscoverySource): DiscoveredArticle | null {
    if (!raw.url || !raw.title) return null;

    return {
      id: uuidv4(),
      url: raw.url.trim(),
      title: raw.title.trim(),
      snippet: raw.snippet || '',
      source: raw.source || '',
      publishedAt: raw.publishedDate ? new Date(raw.publishedDate) : undefined,
      rankPosition: raw.rankPosition,
      category,
      discoveredVia: source,
    };
  }

  /**
   * Deduplicate articles by exact URL match, keeping first occurrence.
   */
  deduplicateArticles(articles: DiscoveredArticle[]): DiscoveredArticle[] {
    const seen = new Set<string>();
    return articles.filter(article => {
      const url = article.url.toLowerCase();
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  }
}
