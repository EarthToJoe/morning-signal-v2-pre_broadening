import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Built-in presets (these get created in DB on first access)
const PRESETS = [
  {
    name: 'The Morning Signal',
    audience: 'Senior government, military, and industry decision-makers in defense, energy, and technology sectors',
    categories: [
      { category: 'defense', displayName: 'Defense & National Security', objective: 'U.S. and allied defense developments including military contracts, weapons programs, force posture changes, Pentagon policy, NATO operations, defense industry news, and military technology.', searchQueries: ['US defense policy', 'Pentagon military', 'NATO defense', 'defense technology contracts'] },
      { category: 'energy', displayName: 'Energy & Infrastructure', objective: 'Energy sector developments including oil & gas markets, renewable energy projects, grid infrastructure, nuclear energy policy, energy legislation, utility company news, and energy technology.', searchQueries: ['energy policy regulation', 'nuclear energy developments', 'renewable energy infrastructure', 'oil gas geopolitics'] },
      { category: 'technology', displayName: 'Technology & Innovation', objective: 'Technology developments relevant to government and enterprise including cybersecurity incidents, AI policy and regulation, cloud computing contracts, semiconductor supply chain, space technology, and federal IT modernization.', searchQueries: ['AI artificial intelligence policy', 'cybersecurity threats', 'semiconductor chip industry', 'space technology defense'] },
      { category: 'policy', displayName: 'Policy & Geopolitics', objective: 'U.S. government policy affecting defense, energy, and technology sectors including executive orders, congressional legislation, regulatory actions, budget decisions, and agency leadership changes.', searchQueries: ['US foreign policy', 'congressional defense legislation', 'geopolitical tensions', 'trade policy national security'] },
    ],
  },
  {
    name: 'Tech Pulse',
    audience: 'Technology executives, startup founders, and engineers tracking AI, cybersecurity, and cloud trends',
    categories: [
      { category: 'ai_ml', displayName: 'AI & Machine Learning', objective: 'Artificial intelligence and machine learning developments including new model releases, AI regulation, enterprise AI adoption, and research breakthroughs.', searchQueries: ['artificial intelligence news', 'machine learning breakthroughs', 'AI regulation policy'] },
      { category: 'cybersecurity', displayName: 'Cybersecurity', objective: 'Cybersecurity incidents, vulnerabilities, threat intelligence, and security industry news.', searchQueries: ['cybersecurity breach incident', 'vulnerability disclosure', 'ransomware attack'] },
      { category: 'cloud', displayName: 'Cloud & Infrastructure', objective: 'Cloud computing, data center, and infrastructure developments including major provider announcements, enterprise migrations, and infrastructure investments.', searchQueries: ['cloud computing AWS Azure Google', 'data center infrastructure', 'enterprise cloud migration'] },
      { category: 'startups', displayName: 'Startups & Funding', objective: 'Startup funding rounds, acquisitions, IPOs, and venture capital trends in technology.', searchQueries: ['startup funding round', 'tech acquisition', 'venture capital investment'] },
    ],
  },
  {
    name: 'Energy Watch',
    audience: 'Energy industry professionals, policy makers, and investors tracking markets and regulation',
    categories: [
      { category: 'oil_gas', displayName: 'Oil & Gas', objective: 'Oil and gas market developments, production changes, OPEC decisions, and pipeline projects.', searchQueries: ['oil price OPEC production', 'natural gas pipeline', 'petroleum industry news'] },
      { category: 'renewables', displayName: 'Renewables & Clean Energy', objective: 'Solar, wind, and clean energy project developments, installations, and policy incentives.', searchQueries: ['solar wind renewable energy', 'clean energy project', 'renewable energy policy incentive'] },
      { category: 'grid', displayName: 'Grid & Infrastructure', objective: 'Electric grid modernization, transmission projects, energy storage, and utility company developments.', searchQueries: ['electric grid modernization', 'energy storage battery', 'utility infrastructure investment'] },
      { category: 'nuclear', displayName: 'Nuclear Energy', objective: 'Nuclear energy developments including new reactor projects, SMR technology, nuclear policy, and decommissioning.', searchQueries: ['nuclear energy reactor', 'small modular reactor SMR', 'nuclear policy regulation'] },
    ],
  },
];

// GET /api/profiles/presets — Get all preset templates (for the setup wizard)
router.get('/presets', (_req: Request, res: Response) => {
  res.json({ presets: PRESETS });
});

// GET /api/profiles — List all saved profiles
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT np.*, json_agg(json_build_object(
        'id', tc.id, 'category', tc.category, 'displayName', tc.display_name,
        'searchQueries', tc.search_queries, 'objective', tc.objective,
        'preferredSources', tc.preferred_sources, 'priority', tc.priority, 'isActive', tc.is_active
      ) ORDER BY tc.priority) FILTER (WHERE tc.id IS NOT NULL) as categories
      FROM newsletter_profiles np
      LEFT JOIN topic_config tc ON tc.profile_id = np.id
      GROUP BY np.id ORDER BY np.created_at DESC`
    );
    const profiles = result.rows.map((r: any) => ({
      id: r.id, name: r.name, audience: r.audience, isPreset: r.is_preset,
      createdAt: r.created_at, categories: r.categories || [],
    }));
    res.json({ profiles });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/profiles/:id — Get a single profile with its categories
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM newsletter_profiles WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    const profile = result.rows[0];

    const cats = await query(
      'SELECT * FROM topic_config WHERE profile_id = $1 ORDER BY priority', [req.params.id]
    );
    const categories = cats.rows.map((r: any) => ({
      id: r.id, category: r.category, displayName: r.display_name,
      searchQueries: r.search_queries, objective: r.objective,
      preferredSources: r.preferred_sources, priority: r.priority, isActive: r.is_active,
    }));

    res.json({
      id: profile.id, name: profile.name, audience: profile.audience,
      isPreset: profile.is_preset, createdAt: profile.created_at, categories,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/profiles — Create a new profile with categories
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, audience, categories } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!categories || categories.length === 0) return res.status(400).json({ error: 'At least one category is required' });

    const profileResult = await query(
      'INSERT INTO newsletter_profiles (name, audience, is_preset) VALUES ($1, $2, false) RETURNING id',
      [name, audience || '']
    );
    const profileId = profileResult.rows[0].id;

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      await query(
        `INSERT INTO topic_config (category, display_name, search_queries, objective, preferred_sources, priority, is_active, profile_id)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, true, $7)`,
        [cat.category, cat.displayName, JSON.stringify(cat.searchQueries || []),
         cat.objective || '', cat.preferredSources || '', i + 1, profileId]
      );
    }

    res.json({ id: profileId, name, audience, categories });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/profiles/:id — Delete a profile (cascades to topic_config)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM newsletter_profiles WHERE id = $1 AND is_preset = false', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as profilesRouter };
