import * as cheerio from 'cheerio';
import { createCorrelatedLogger } from '../utils/logger';
import { FetchedArticleMetadata } from '../types';

export class UrlFetcherService {
  /**
   * Fetch article metadata from a URL using HTML meta/OG tags.
   */
  async fetchMetadata(url: string, correlationId?: string): Promise<FetchedArticleMetadata> {
    const log = createCorrelatedLogger(correlationId || 'manual', 'url-fetcher');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        headers: { 'User-Agent': 'MorningSignalBot/2.0' },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return { url, title: '', snippet: '', source: '', success: false, error: `HTTP ${response.status}` };
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const title = $('meta[property="og:title"]').attr('content')
        || $('meta[name="twitter:title"]').attr('content')
        || $('title').text()
        || '';

      const snippet = $('meta[property="og:description"]').attr('content')
        || $('meta[name="description"]').attr('content')
        || $('meta[name="twitter:description"]').attr('content')
        || '';

      const source = $('meta[property="og:site_name"]').attr('content')
        || new URL(url).hostname.replace('www.', '')
        || '';

      const publishedAtStr = $('meta[property="article:published_time"]').attr('content')
        || $('meta[name="date"]').attr('content')
        || '';

      const publishedAt = publishedAtStr ? new Date(publishedAtStr) : undefined;

      log.info('URL metadata fetched', { url, title: title.substring(0, 60), source });

      return { url, title: title.trim(), snippet: snippet.trim(), source: source.trim(), publishedAt, success: true };
    } catch (err: any) {
      log.error('URL fetch failed', { url, error: err.message });
      return { url, title: '', snippet: '', source: '', success: false, error: err.message };
    }
  }
}
