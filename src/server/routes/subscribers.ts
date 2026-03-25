import { Router, Request, Response } from 'express';
import { SubscriberManagerService } from '../../services/subscriber-manager';

const router = Router();
const subscriberManager = new SubscriberManagerService();

// GET /api/subscribers
router.get('/', async (_req: Request, res: Response) => {
  try {
    const subscribers = await subscriberManager.getAllSubscribers();
    res.json({ subscribers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/subscribers
router.post('/', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });
    const subscriber = await subscriberManager.addSubscriber(email);
    res.status(201).json({ subscriber });
  } catch (error: any) {
    if (error.message.includes('Invalid email')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/subscribers/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const subscriber = await subscriberManager.getById(req.params.id);
    if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
    await subscriberManager.unsubscribe(req.params.id);
    res.json({ success: true, message: 'Unsubscribed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as subscribersRouter };
