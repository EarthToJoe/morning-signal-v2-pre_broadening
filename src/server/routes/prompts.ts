import { Router, Request, Response } from 'express';
import { PromptManagerService } from '../../services/prompt-manager';
import { PipelineStage } from '../../types';

const router = Router();
const promptManager = new PromptManagerService();

const VALID_STAGES: PipelineStage[] = ['content_researcher', 'story_writer_lead', 'story_writer_briefings', 'subject_line_generator'];

function isValidStage(stage: string): stage is PipelineStage {
  return VALID_STAGES.includes(stage as PipelineStage);
}

// GET /api/prompts — Get all active prompts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const prompts = await promptManager.getAllPrompts();
    res.json({ prompts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/prompts/:stage — Get prompt for a specific stage
router.get('/:stage', async (req: Request, res: Response) => {
  try {
    const { stage } = req.params;
    if (!isValidStage(stage)) {
      return res.status(400).json({ error: `Invalid stage. Valid stages: ${VALID_STAGES.join(', ')}` });
    }
    const prompt = await promptManager.getActivePrompt(stage);
    res.json({ prompt });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/prompts/:stage — Save editor-modified prompt
router.put('/:stage', async (req: Request, res: Response) => {
  try {
    const { stage } = req.params;
    if (!isValidStage(stage)) {
      return res.status(400).json({ error: `Invalid stage. Valid stages: ${VALID_STAGES.join(', ')}` });
    }
    const { promptText } = req.body;
    if (!promptText || typeof promptText !== 'string') {
      return res.status(400).json({ error: 'promptText is required and must be a string' });
    }
    await promptManager.savePrompt(stage, promptText);
    res.json({ success: true, message: `Prompt saved for ${stage}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/prompts/:stage — Revert to system default
router.delete('/:stage', async (req: Request, res: Response) => {
  try {
    const { stage } = req.params;
    if (!isValidStage(stage)) {
      return res.status(400).json({ error: `Invalid stage. Valid stages: ${VALID_STAGES.join(', ')}` });
    }
    await promptManager.revertToDefault(stage);
    res.json({ success: true, message: `Prompt reverted to default for ${stage}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as promptsRouter };
