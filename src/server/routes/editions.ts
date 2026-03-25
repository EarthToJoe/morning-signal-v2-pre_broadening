import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { CostTrackerService } from '../../services/cost-tracker';

const router = Router();
const costTracker = new CostTrackerService();

// GET /api/editions/:correlationId — Get edition details
router.get('/:correlationId', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM editions WHERE correlation_id = $1', [req.params.correlationId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Edition not found' });
    res.json({ edition: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/editions/:correlationId/cost — Get per-edition cost summary
router.get('/:correlationId/cost', async (req: Request, res: Response) => {
  try {
    const summary = await costTracker.getEditionSummary(req.params.correlationId);
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as editionsRouter };
