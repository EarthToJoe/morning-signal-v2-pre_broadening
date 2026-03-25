/**
 * Quick test script for Parallel AI Search API.
 * Run: npx ts-node test-parallel-ai.ts
 * 
 * Tests the recommended approach: objective + search_queries + source_policy + fetch_policy
 * to get specific news articles instead of generic website homepages.
 */
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.PARALLEL_AI_API_KEY;

if (!API_KEY || API_KEY === 'REPLACE_ME') {
  console.error('❌ Set PARALLEL_AI_API_KEY in .env first');
  process.exit(1);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function testSearch() {
  console.log('🔍 Testing Parallel AI Search API (objective + search_queries approach)...\n');

  // This is the key fix: use `objective` for natural language context about what
  // we want, and `search_queries` for specific keywords. Together they produce
  // much more targeted results than a bare query string alone.
  const requestBody = {
    objective: `Find specific, individual news articles published in the last few days. I need articles with unique URLs that point to individual stories — NOT website homepages, section landing pages, company LinkedIn profiles, or topic index pages. Each result should be a single news story or report with a specific headline, author or publication date, and substantive content. Prefer articles from established news outlets. Topic: U.S. and allied defense developments including military contracts, weapons programs, force posture changes, Pentagon policy, NATO operations, defense industry news, and military technology. Preferred sources: Defense News, Breaking Defense, Defense One, Military Times, Stars and Stripes, Reuters, AP, USNI News.`,
    search_queries: [
      'US defense technology developments 2026',
      'Pentagon military contracts awards',
      'defense industry news this week',
    ],
    max_results: 5,
    excerpts: { max_chars_per_result: 5000, max_chars_total: 20000 },
    source_policy: {
      after_date: daysAgo(3),
      exclude_domains: ['linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com'],
    },
    fetch_policy: { max_age_seconds: 172800 },
  };

  console.log('Objective:', requestBody.objective.substring(0, 120) + '...');
  console.log('Search queries:', requestBody.search_queries);
  console.log('After date:', requestBody.source_policy.after_date);
  console.log('');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await fetch('https://api.parallel.ai/v1beta/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY!,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    console.error(`❌ API error: ${response.status} ${response.statusText}`);
    const body = await response.text();
    console.error('Response body:', body);
    process.exit(1);
  }

  const data = await response.json();

  console.log('✅ API call successful!\n');
  console.log('Search ID:', (data as any).search_id);
  console.log('Result count:', (data as any).results?.length || 0);
  console.log('Usage:', JSON.stringify((data as any).usage, null, 2));
  console.log('Warnings:', (data as any).warnings);
  console.log('\n--- Results ---\n');

  for (const [i, result] of ((data as any).results || []).entries()) {
    console.log(`[${i}] ${result.title}`);
    console.log(`    URL: ${result.url}`);
    console.log(`    Published: ${result.publish_date || 'N/A'}`);
    console.log(`    Excerpts: ${result.excerpts?.length || 0} snippet(s), ~${(result.excerpts || []).reduce((sum: number, e: string) => sum + e.length, 0)} chars total`);
    if (result.excerpts?.[0]) {
      const preview = result.excerpts[0].substring(0, 300);
      console.log(`    Preview: ${preview}...`);
    }
    console.log('');
  }

  // Check: are these specific articles or generic homepages?
  console.log('--- Quality Check ---');
  let homepageCount = 0;
  for (const result of ((data as any).results || [])) {
    const url = result.url || '';
    const path = new URL(url).pathname;
    if (path === '/' || path === '') {
      homepageCount++;
      console.log(`⚠️  Possible homepage: ${url}`);
    }
  }
  if (homepageCount === 0) {
    console.log('✅ All results appear to be specific articles (no root-path URLs)');
  } else {
    console.log(`⚠️  ${homepageCount} result(s) may be homepages`);
  }
}

testSearch().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
