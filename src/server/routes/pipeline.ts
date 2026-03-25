import { Router, Request, Response } from 'express';
import { PipelineOrchestrator } from '../../pipeline/orchestrator';
import { query } from '../../config/database';

const router = Router();
const orchestrator = new PipelineOrchestrator();

// POST /api/pipeline/start — Start a new pipeline run (Phase 1)
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { promptOverride } = req.body || {};
    const status = await orchestrator.startPipeline(undefined, promptOverride);
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/pipeline/:correlationId/status — Get pipeline status
router.get('/:correlationId/status', async (req: Request, res: Response) => {
  try {
    const status = await orchestrator.getStatus(req.params.correlationId);
    res.json(status);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

// POST /api/pipeline/:correlationId/continue — Continue after editor selection (Phase 2)
router.post('/:correlationId/continue', async (req: Request, res: Response) => {
  try {
    const { selections, promptOverrides } = req.body;
    if (!selections) {
      return res.status(400).json({ error: 'selections is required' });
    }
    const status = await orchestrator.continueAfterSelection(
      req.params.correlationId, selections, promptOverrides
    );
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/test/full-run — Temporary: run entire pipeline end-to-end with auto-selection
router.post('/test/full-run', async (req: Request, res: Response) => {
  try {
    // Phase 1
    const phase1 = await orchestrator.startPipeline();
    if (phase1.status === 'failed') {
      return res.status(500).json({ error: 'Phase 1 failed', details: phase1 });
    }

    // Auto-select: pick first candidate as lead, next 4 as quick hits, rest as watch list
    const candidatesResult = await query(
      `SELECT sc.*, json_agg(json_build_object(
        'id', a.id, 'url', a.url, 'title', a.title, 'snippet', a.snippet,
        'source', a.source, 'category', a.category, 'rankPosition', a.rank_position
      )) as source_articles
      FROM story_candidates sc
      JOIN editions e ON sc.edition_id = e.id
      LEFT JOIN story_candidate_articles sca ON sc.id = sca.story_candidate_id
      LEFT JOIN articles a ON sca.article_id = a.id
      WHERE e.correlation_id = $1
      GROUP BY sc.id
      ORDER BY sc.created_at`,
      [phase1.correlationId]
    );

    const candidates = candidatesResult.rows.map((row: any) => ({
      id: row.id,
      suggestedRole: row.suggested_role,
      headline: row.headline,
      narrativeSummary: row.narrative_summary,
      sourceArticleIds: (row.source_articles || []).filter((a: any) => a.id).map((a: any) => a.id),
      sourceArticles: (row.source_articles || []).filter((a: any) => a.id),
      category: row.category,
      isManualStory: row.is_manual_story,
    }));

    if (candidates.length === 0) {
      return res.status(500).json({ error: 'No candidates generated' });
    }

    const selections = {
      leadStory: candidates[0],
      quickHits: candidates.slice(1, 5),
      watchListItems: candidates.slice(5, 8),
    };

    // Phase 2
    const phase2 = await orchestrator.continueAfterSelection(phase1.correlationId, selections);

    // Fetch assembled newsletter
    const newsletterResult = await query(
      `SELECT an.* FROM assembled_newsletters an
       JOIN editions e ON an.edition_id = e.id
       WHERE e.correlation_id = $1`,
      [phase1.correlationId]
    );

    res.json({
      correlationId: phase1.correlationId,
      status: phase2,
      newsletter: newsletterResult.rows[0] || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as pipelineRouter };
