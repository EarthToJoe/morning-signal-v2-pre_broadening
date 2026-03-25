import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { StoryWriterService } from '../../services/story-writer';
import { UrlFetcherService } from '../../services/url-fetcher';
import { ArticleDiscoveryService, ParallelAiClient } from '../../services/article-discovery';
import { ContentResearcherService } from '../../services/content-researcher';
import { CostTrackerService } from '../../services/cost-tracker';
import { PromptManagerService } from '../../services/prompt-manager';
import { EmailDeliveryService } from '../../services/email-delivery';
import { SubscriberManagerService } from '../../services/subscriber-manager';
import { NewsletterAssemblerService, PRESET_THEMES, DEFAULT_THEME, NewsletterTheme } from '../../services/newsletter-assembler';
import { PipelineOrchestrator } from '../../pipeline/orchestrator';
import { config } from '../../config';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const costTracker = new CostTrackerService();
const promptManager = new PromptManagerService();
const storyWriter = new StoryWriterService(promptManager, costTracker);
const urlFetcher = new UrlFetcherService();
const searchClient = new ParallelAiClient(config.parallelAiApiKey);
const articleDiscovery = new ArticleDiscoveryService(searchClient, costTracker);
const contentResearcher = new ContentResearcherService(promptManager, costTracker);
const subscriberManager = new SubscriberManagerService();
const emailDelivery = new EmailDeliveryService(subscriberManager);
const newsletterAssembler = new NewsletterAssemblerService();
const orchestrator = new PipelineOrchestrator();

// Helper: get edition ID from correlation ID
async function getEditionId(correlationId: string): Promise<string> {
  const result = await query('SELECT id FROM editions WHERE correlation_id = $1', [correlationId]);
  if (result.rows.length === 0) throw new Error('Edition not found');
  return result.rows[0].id;
}

// Helper: record editorial action
async function recordAction(editionId: string, actionType: string, data: any) {
  await query('INSERT INTO editorial_actions (edition_id, action_type, action_data) VALUES ($1, $2, $3)',
    [editionId, actionType, JSON.stringify(data)]);
}

// Helper: load candidates with source articles
async function loadCandidates(editionId: string) {
  const rows = await query(
    `SELECT sc.*,
      COALESCE(json_agg(json_build_object(
        'id', a.id, 'url', a.url, 'title', a.title, 'snippet', a.snippet,
        'source', a.source, 'category', a.category, 'rankPosition', a.rank_position
      )) FILTER (WHERE a.id IS NOT NULL), '[]') as source_articles
    FROM story_candidates sc
    LEFT JOIN story_candidate_articles sca ON sc.id = sca.story_candidate_id
    LEFT JOIN articles a ON sca.article_id = a.id
    WHERE sc.edition_id = $1
    GROUP BY sc.id ORDER BY sc.display_order NULLS LAST, sc.created_at`,
    [editionId]
  );
  return rows.rows.map((row: any) => ({
    id: row.id,
    suggestedRole: row.suggested_role,
    assignedRole: row.assigned_role,
    headline: row.headline,
    narrativeSummary: row.narrative_summary,
    category: row.category,
    isManualStory: row.is_manual_story,
    manualStoryAttribution: row.manual_story_attribution,
    isSelected: row.is_selected,
    displayOrder: row.display_order,
    sourceArticles: row.source_articles,
    sourceArticleCount: row.source_articles.filter((a: any) => a.id).length,
  }));
}

// GET /api/editorial/:correlationId/candidates
router.get('/:correlationId/candidates', async (req: Request, res: Response) => {
  try {
    const editionId = await getEditionId(req.params.correlationId);
    const candidates = await loadCandidates(editionId);
    res.json({ candidates });
  } catch (error: any) {
    res.status(error.message === 'Edition not found' ? 404 : 500).json({ error: error.message });
  }
});

// POST /api/editorial/:correlationId/select — Submit editor selections
router.post('/:correlationId/select', async (req: Request, res: Response) => {
  try {
    const { selections } = req.body;
    if (!selections) return res.status(400).json({ error: 'selections required' });

    const status = await orchestrator.continueAfterSelection(
      req.params.correlationId, selections, req.body.promptOverrides
    );
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/editorial/:correlationId/custom-search
router.post('/:correlationId/custom-search', async (req: Request, res: Response) => {
  try {
    const { queryText } = req.body;
    if (!queryText) return res.status(400).json({ error: 'queryText required' });

    const editionId = await getEditionId(req.params.correlationId);

    // Load existing articles
    const existingResult = await query('SELECT * FROM articles WHERE edition_id = $1', [editionId]);
    const existingArticles = existingResult.rows.map((r: any) => ({
      id: r.id, url: r.url, title: r.title, snippet: r.snippet, source: r.source,
      publishedAt: r.published_at, rankPosition: r.rank_position,
      category: r.category, discoveredVia: r.discovered_via,
    }));

    // Run custom search
    const result = await articleDiscovery.customSearch(queryText, existingArticles, req.params.correlationId);

    // Persist new articles
    const newArticles = result.articles.filter(a => !existingArticles.some((e: any) => e.id === a.id));
    for (const article of newArticles) {
      await query(
        `INSERT INTO articles (id, edition_id, url, title, snippet, source, published_at, rank_position, category, discovered_via)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
        [article.id, editionId, article.url, article.title, article.snippet, article.source,
         article.publishedAt || null, article.rankPosition, article.category, article.discoveredVia]
      );
    }

    // Delete old candidates before re-clustering (they'll be replaced)
    await query('DELETE FROM story_candidate_articles WHERE story_candidate_id IN (SELECT id FROM story_candidates WHERE edition_id = $1)', [editionId]);
    await query('DELETE FROM story_candidates WHERE edition_id = $1', [editionId]);

    // Re-cluster all articles (existing + new)
    const clusteringResult = await contentResearcher.clusterArticles(result.articles, null, req.params.correlationId);

    // Persist new candidates
    for (const candidate of clusteringResult.storyCandidates) {
      await query(
        `INSERT INTO story_candidates (id, edition_id, suggested_role, headline, narrative_summary, category, is_manual_story)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [candidate.id, editionId, candidate.suggestedRole, candidate.headline,
         candidate.narrativeSummary, candidate.category, candidate.isManualStory]
      );
      for (const articleId of candidate.sourceArticleIds) {
        await query('INSERT INTO story_candidate_articles (story_candidate_id, article_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [candidate.id, articleId]);
      }
    }

    await recordAction(editionId, 'custom_search', { query: queryText, newArticles: newArticles.length });

    const candidates = await loadCandidates(editionId);
    res.json({ candidates, searchResult: { newArticles: newArticles.length, totalArticles: result.totalFound } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/editorial/:correlationId/manual-story
router.post('/:correlationId/manual-story', async (req: Request, res: Response) => {
  try {
    const { url, description } = req.body;
    if (!url && !description) return res.status(400).json({ error: 'url or description required' });

    const editionId = await getEditionId(req.params.correlationId);
    const candidateId = uuidv4();

    if (url) {
      // Fetch metadata from URL
      const metadata = await urlFetcher.fetchMetadata(url, req.params.correlationId);
      const articleId = uuidv4();
      const publishedAt = metadata.publishedAt ? metadata.publishedAt.toISOString() : null;

      await query(
        `INSERT INTO articles (id, edition_id, url, title, snippet, source, published_at, rank_position, category, discovered_via)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp, 0, 'policy', 'manual_url')`,
        [articleId, editionId, url, metadata.title || url, metadata.snippet || '', metadata.source || '', publishedAt]
      );

      await query(
        `INSERT INTO story_candidates (id, edition_id, suggested_role, headline, narrative_summary, category, is_manual_story, manual_story_attribution)
         VALUES ($1, $2, 'quick_hit', $3, $4, 'policy', true, 'editor-sourced')`,
        [candidateId, editionId, metadata.title || 'Manual Story', metadata.snippet || '']
      );

      await query('INSERT INTO story_candidate_articles (story_candidate_id, article_id) VALUES ($1, $2)', [candidateId, articleId]);
    } else {
      // Free-text description
      await query(
        `INSERT INTO story_candidates (id, edition_id, suggested_role, headline, narrative_summary, category, is_manual_story, manual_story_attribution)
         VALUES ($1, $2, 'quick_hit', $3, $4, 'policy', true, 'editor-sourced')`,
        [candidateId, editionId, description, description]
      );
    }

    await recordAction(editionId, 'manual_story', { url, description, candidateId });

    const candidates = await loadCandidates(editionId);
    res.json({ candidates, addedCandidateId: candidateId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// GET /api/editorial/:correlationId/draft — Get assembled newsletter draft
router.get('/:correlationId/draft', async (req: Request, res: Response) => {
  try {
    const editionId = await getEditionId(req.params.correlationId);
    const result = await query(
      'SELECT * FROM assembled_newsletters WHERE edition_id = $1', [editionId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Draft not yet assembled' });

    const row = result.rows[0];
    const costSummary = await costTracker.getEditionSummary(req.params.correlationId);

    res.json({
      html: row.html_content,
      plainText: row.plain_text_content,
      selectedSubjectLine: row.selected_subject_line,
      subjectLineOptions: row.subject_line_options,
      sectionMetadata: row.section_metadata,
      costSummary,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/editorial/:correlationId/edit-section — Inline edit a section
router.post('/:correlationId/edit-section', async (req: Request, res: Response) => {
  try {
    const { sectionId, headline, htmlContent, plainTextContent } = req.body;
    if (!sectionId) return res.status(400).json({ error: 'sectionId required' });

    const editionId = await getEditionId(req.params.correlationId);

    await query(
      `UPDATE written_sections SET headline = COALESCE($1, headline),
       html_content = COALESCE($2, html_content),
       plain_text_content = COALESCE($3, plain_text_content),
       written_at = NOW() WHERE id = $4`,
      [headline || null, htmlContent || null, plainTextContent || null, sectionId]
    );

    await recordAction(editionId, 'edit_content', { sectionId, headline });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/editorial/:correlationId/regenerate-section
router.post('/:correlationId/regenerate-section', async (req: Request, res: Response) => {
  try {
    const { sectionId, promptOverride } = req.body;
    if (!sectionId) return res.status(400).json({ error: 'sectionId required' });

    const editionId = await getEditionId(req.params.correlationId);

    // Load the section and its candidate
    const sectionResult = await query('SELECT * FROM written_sections WHERE id = $1', [sectionId]);
    if (sectionResult.rows.length === 0) return res.status(404).json({ error: 'Section not found' });
    const section = sectionResult.rows[0];

    const candidateId = section.story_candidate_id;
    const candidates = await loadCandidates(editionId);
    const candidate = candidates.find((c: any) => c.id === candidateId);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found for section' });

    const writtenSection = {
      role: section.role, storyCandidateId: candidateId, headline: section.headline,
      htmlContent: section.html_content, plainTextContent: section.plain_text_content,
      wordCount: section.word_count, sourceLinks: section.source_links || [],
    };

    const candidateForWriter = {
      id: candidate.id, suggestedRole: candidate.suggestedRole as any,
      headline: candidate.headline, narrativeSummary: candidate.narrativeSummary,
      sourceArticleIds: candidate.sourceArticles.map((a: any) => a.id),
      sourceArticles: candidate.sourceArticles,
      category: candidate.category as any, isManualStory: candidate.isManualStory,
    };

    const regenerated = await storyWriter.regenerateSection(
      writtenSection as any, candidateForWriter, promptOverride || null, req.params.correlationId
    );

    // Update in DB
    await query(
      `UPDATE written_sections SET headline = $1, html_content = $2, plain_text_content = $3,
       word_count = $4, source_links = $5, written_at = NOW() WHERE id = $6`,
      [regenerated.headline, regenerated.htmlContent, regenerated.plainTextContent,
       regenerated.wordCount, JSON.stringify(regenerated.sourceLinks), sectionId]
    );

    await recordAction(editionId, 'regenerate_section', { sectionId });
    res.json({ section: regenerated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/editorial/:correlationId/approve — Approve and deliver
router.post('/:correlationId/approve', async (req: Request, res: Response) => {
  try {
    const { subjectLine } = req.body;
    const editionId = await getEditionId(req.params.correlationId);

    // Get assembled newsletter
    const nlResult = await query('SELECT * FROM assembled_newsletters WHERE edition_id = $1', [editionId]);
    if (nlResult.rows.length === 0) return res.status(400).json({ error: 'Newsletter not yet assembled' });

    const nl = nlResult.rows[0];
    const finalSubject = subjectLine || nl.selected_subject_line;

    // Update subject line if changed
    if (subjectLine) {
      await query('UPDATE assembled_newsletters SET selected_subject_line = $1 WHERE edition_id = $2', [subjectLine, editionId]);
    }

    // Mark approved
    await query('UPDATE editions SET status = $1 WHERE correlation_id = $2', ['approved', req.params.correlationId]);
    await recordAction(editionId, 'approve', { subjectLine: finalSubject });

    // Deliver
    const report = await emailDelivery.deliver(
      { html: nl.html_content, plainText: nl.plain_text_content, editionNumber: 0, editionDate: '', sectionMetadata: [] },
      finalSubject, req.params.correlationId
    );

    await query('UPDATE editions SET status = $1, completed_at = NOW() WHERE correlation_id = $2', ['delivered', req.params.correlationId]);

    res.json({ success: true, deliveryReport: report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/editorial/:correlationId/reject — Reject with feedback
router.post('/:correlationId/reject', async (req: Request, res: Response) => {
  try {
    const { feedback, returnToPhase1 } = req.body;
    const editionId = await getEditionId(req.params.correlationId);

    await recordAction(editionId, 'reject', { feedback, returnToPhase1 });

    if (returnToPhase1) {
      await query('UPDATE editions SET status = $1 WHERE correlation_id = $2', ['awaiting_selection', req.params.correlationId]);
    }

    res.json({ success: true, message: returnToPhase1 ? 'Returned to Phase 1' : 'Rejection recorded' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/editorial/themes — Get available themes
router.get('/themes', (_req: Request, res: Response) => {
  res.json({ presets: PRESET_THEMES, default: DEFAULT_THEME });
});

// POST /api/editorial/:correlationId/reassemble — Re-assemble newsletter with theme + edited sections
router.post('/:correlationId/reassemble', async (req: Request, res: Response) => {
  try {
    const { theme } = req.body;
    const editionId = await getEditionId(req.params.correlationId);

    // Load written sections from DB
    const sectionsResult = await query(
      'SELECT * FROM written_sections WHERE edition_id = $1 ORDER BY role, id', [editionId]
    );
    const sections = sectionsResult.rows;

    const leadSection = sections.find((s: any) => s.role === 'lead_story');
    const quickHitSections = sections.filter((s: any) => s.role === 'quick_hit');
    const watchListSections = sections.filter((s: any) => s.role === 'watch_list');

    if (!leadSection) return res.status(400).json({ error: 'No lead story found' });

    const writtenNewsletter = {
      leadStory: { role: 'lead_story' as const, storyCandidateId: leadSection.story_candidate_id, headline: leadSection.headline, htmlContent: leadSection.html_content, plainTextContent: leadSection.plain_text_content, wordCount: leadSection.word_count, sourceLinks: leadSection.source_links || [] },
      quickHits: quickHitSections.map((s: any) => ({ role: 'quick_hit' as const, storyCandidateId: s.story_candidate_id, headline: s.headline, htmlContent: s.html_content, plainTextContent: s.plain_text_content, wordCount: s.word_count, sourceLinks: s.source_links || [] })),
      watchList: watchListSections.map((s: any) => ({ role: 'watch_list' as const, storyCandidateId: s.story_candidate_id, headline: s.headline, htmlContent: s.html_content, plainTextContent: s.plain_text_content, wordCount: s.word_count, sourceLinks: s.source_links || [] })),
      totalWordCount: 0, tokenUsage: { input: 0, output: 0 }, cost: 0,
    };

    const edition = await query('SELECT edition_number, edition_date FROM editions WHERE correlation_id = $1', [req.params.correlationId]);
    const subjectResult = await query('SELECT selected_subject_line FROM assembled_newsletters WHERE edition_id = $1', [editionId]);
    const subjectLine = subjectResult.rows[0]?.selected_subject_line || config.newsletterName;

    const assembled = await newsletterAssembler.assemble(
      writtenNewsletter, subjectLine,
      edition.rows[0].edition_number, edition.rows[0].edition_date,
      req.params.correlationId, theme
    );

    // Update assembled newsletter in DB
    await query(
      `UPDATE assembled_newsletters SET html_content = $1, plain_text_content = $2, section_metadata = $3 WHERE edition_id = $4`,
      [assembled.html, assembled.plainText, JSON.stringify(assembled.sectionMetadata), editionId]
    );

    res.json({ html: assembled.html, plainText: assembled.plainText, sectionMetadata: assembled.sectionMetadata });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/editorial/:correlationId/sections — Get individual written sections for editing
router.get('/:correlationId/sections', async (req: Request, res: Response) => {
  try {
    const editionId = await getEditionId(req.params.correlationId);
    const result = await query(
      'SELECT id, story_candidate_id, role, headline, html_content, plain_text_content, word_count, source_links FROM written_sections WHERE edition_id = $1 ORDER BY role, id',
      [editionId]
    );
    const sections = result.rows.map((r: any) => ({
      id: r.id, storyCandidateId: r.story_candidate_id, role: r.role,
      headline: r.headline, htmlContent: r.html_content, plainTextContent: r.plain_text_content,
      wordCount: r.word_count, sourceLinks: r.source_links || [],
    }));
    res.json({ sections });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as editorialRouter };
