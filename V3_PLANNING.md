# V3 Planning Document — AI-Powered Briefing & Newsletter Platform

---

## 1. V2 Preservation / Freeze Statement

### What V2 Is
V2 is a working AI-assisted newsletter creation platform. A user describes a topic, the system discovers real news articles, AI clusters and writes stories, the user reviews and refines through a three-phase editorial workflow, and the system produces a professional HTML email newsletter. It works across any topic area at ~$0.25/edition.

### What Should Be Preserved As-Is
These are proven, stable components that should carry forward directly into V3:

**Pipeline logic:**
- The deterministic pipeline sequence: Search → Cluster → Select → Write → Assemble → Review
- The search-API-first architecture (Parallel AI finds articles, GPT only writes)
- The two-layer search input system (user writes plain English, system wraps in Parallel AI boilerplate)
- The `buildObjective()` function and its boilerplate structure — this is a hard-won asset
- The 3-call writing split: lead story (dedicated), quick hits (dedicated), watch list (dedicated)
- Graceful degradation (skip failed sections, fallback subject lines)

**Prompt assets (treat as valuable IP):**
- Content researcher clustering prompt — instruction 8 about single-source candidates was a key quality improvement
- Lead story prompt — the "MINIMUM 400 words" + "Why This Matters" + "DO NOT fabricate" instructions
- Quick hits prompt — the "things that ALREADY HAPPENED" framing that differentiates from watch list
- Watch list prompt — the "FORWARD-LOOKING" + "HAVE NOT happened yet" framing
- The defensive JSON parsing logic in `parseLlmJson()`
- The "DO NOT write fewer than X words" instruction pattern (LLMs respond to explicit minimums)

**Search tuning:**
- The Parallel AI objective structure: base boilerplate + "Topic: {user description}"
- The `source_policy.exclude_domains` list (linkedin, facebook, twitter, youtube)
- The `source_policy.after_date` freshness filter
- The `fetch_policy.max_age_seconds: 172800` (2-day) default
- The `max_results: 15` per category setting
- The `excerpts: { max_chars_per_result: 10000, max_chars_total: 50000 }` settings

**Services:**
- ArticleDiscoveryService — validation, dedup, category coverage tracking
- CostTrackerService — per-call recording and per-edition aggregation
- PromptManagerService — default/override/revert logic
- UrlFetcherService — metadata extraction for manual stories
- NewsletterAssemblerService — MJML compilation, theme variables, plain text generation

**Database schema:**
- The core tables: editions, articles, story_candidates, story_candidate_articles, written_sections, assembled_newsletters, cost_entries, editorial_actions, saved_prompts, subscribers, topic_config, newsletter_profiles

### Core Strengths That Should Not Be Casually Disrupted
1. The AI pipeline IS the product. V3 should build around it, not beside it.
2. The three-phase editorial flow (select → edit → style) is the right separation of concerns.
3. The preset system teaches users what good inputs look like.
4. The "Show search details" transparency toggle is a differentiator.
5. The Parallel AI Tuning Lab is a unique power-user/debugging tool.
6. Per-edition cost tracking gives users confidence in the economics.

### What Should Not Happen in V3
- Do not replace the AI pipeline with a manual newsletter builder
- Do not make the default path slower or more complex
- Do not remove the preset system in favor of only custom creation
- Do not rebuild prompts from scratch — adapt and extend the proven ones
- Do not abstract the pipeline into a generic "workflow engine" — the deterministic sequence is a feature

### Prompt Architecture Preservation Directive
The V2 prompting system is not a collection of text strings — it is a tuned, interdependent architecture that took significant iteration to reach its current quality level. V3 MUST reuse the V2 prompt logic, structures, instruction patterns, and output-shaping techniques directly. This includes:

- The instruction layering pattern (numbered instructions with explicit minimums and "DO NOT" constraints)
- The JSON output format specifications embedded in each prompt
- The defensive parsing pipeline (`parseLlmJson()` handling raw JSON, markdown-wrapped JSON, and missing fields)
- The relationship between the clustering prompt's output format and the story writer's input format (article indices → candidate objects → source articles fed into writing prompts)
- The specific instruction wordings that were discovered through testing: "DO NOT write fewer than X words," "things that ALREADY HAPPENED" vs "HAVE NOT happened yet," "present it as its own single-source candidate"
- The temperature settings per call type (0.3 for clustering, 0.5 for lead story, 0.4 for briefings)
- The `response_format: { type: 'json_object' }` enforcement on all LLM calls

If V3 needs to modify a prompt, the modification should be additive (add new instructions, add template variables like `{{audience}}`) rather than rewriting from scratch. The V2 prompt files and database seed data should be treated as the starting point, not as disposable scaffolding.

Where V3 introduces new prompt capabilities (e.g., audience-aware writing, source preference injection), these should be implemented as new template variables inserted into the existing prompt structures, not as replacement prompts.

---

## 2. V3 Product Vision

### What V3 Is
V3 is the transition from "working prototype" to "usable product." It takes the proven V2 pipeline and editorial workflow and wraps it in the infrastructure needed for real, recurring use: user accounts, persistent newsletters, reliable delivery, edition history, and a polished UI.

### Who It Is For
Primary: An individual who wants to produce a recurring professional newsletter or briefing on a topic they care about, without spending hours on research and writing.

This person might be:
- An analyst producing a weekly defense/energy/tech briefing for their team
- A subject matter expert who wants to share curated news with their network
- A small publisher running a niche newsletter (skateboarding, space, local politics)
- A professional who currently spends 2-3 hours manually curating news and wants to cut that to 20 minutes

### One-Line Description
**Describe your topic. Get a professional newsletter. Publish it.**

### Major Product Principles
1. **AI-first, human-final.** The AI does the research and first draft. The human makes the editorial decisions.
2. **Topic-first.** Everything starts with what the user cares about, not with a blank editor.
3. **Source-grounded.** Every story is backed by real, discoverable articles with clickable URLs.
4. **Fast path by default.** A user should be able to go from topic to publishable newsletter in under 10 minutes of active work.
5. **Transparency on demand.** Users can see exactly what the AI is doing (search inputs, prompts, costs) but don't have to.
6. **Recurring by design.** The product should make it easy to publish the same newsletter weekly/daily, not just once.

### How It Differs From General Newsletter Platforms
- Substack/Beehiiv: You write everything yourself. AI is an afterthought or bolt-on.
- This product: You describe a topic. The system finds articles, organizes stories, and writes a draft. You refine and publish.
- The AI pipeline is the core product, not a feature. The editorial workflow is designed around AI output, not around a blank page.

---

## 3. V3 Scope Boundary

### V3 IS:
- A single-user product that one person uses to create and publish newsletters
- Account-based (login, own your newsletters, see your history)
- Capable of recurring publication (same newsletter, new edition each week)
- Deployed to a real URL (hughesnode.com) so it's accessible from anywhere
- Polished enough that the user doesn't need to understand the underlying tech
- Fast enough that the pipeline feels responsive (target: under 90 seconds for Phase 1)

### V3 IS NOT:
- A multi-user SaaS platform (one user is fine for V3)
- A marketplace or discovery platform for newsletters
- A subscriber growth tool (no referral programs, no recommendation engine)
- A full analytics suite (basic delivery stats are enough)
- A public archive or SEO-optimized newsletter hosting site
- A mobile app
- A Substack competitor in terms of feature breadth

### Opinionated Scope Decisions:
- **One user, multiple newsletters.** Don't build multi-tenant yet. One account, multiple newsletter profiles.
- **Email delivery must work.** SendGrid integration needs to be tested and reliable. This is the minimum bar for "real product."
- **No public pages yet.** Newsletters are sent via email. No web archive, no public landing pages. That's V4.
- **No analytics beyond delivery stats.** Sent count, failure count, maybe open rate if SendGrid provides it. No click tracking, no engagement dashboards.
- **No scheduled automation yet.** The user triggers each run manually. Scheduling is V4.
- **React frontend.** The vanilla JS served its purpose. V3 needs proper components, routing, and state management.

---

## 4. Prioritized V3 Roadmap

### Must-Have for First V3 Release
1. **Authentication** — Supabase Auth, email/password login. User owns their data.
2. **React frontend rebuild** — proper routing, component architecture, state management. Preserve the three-phase flow exactly.
3. **Edition history sidebar** — browse past editions, click to view or resume. Shows status, date, newsletter name, lead headline.
4. **Profile management** — create, edit, delete newsletter profiles. See all your newsletters in one place.
5. **Performance: parallel search calls** — cut Phase 1 from ~60s to ~20s.
6. **Performance: batched DB writes** — cut article/candidate persistence from seconds to milliseconds.
7. **Audience-aware GPT prompts** — inject the profile's audience description into all writing prompts.
8. **Preferred sources wired in** — the field exists, wire it into the Parallel AI objective.
9. **Working email delivery** — test SendGrid end-to-end. Send a real newsletter to a real inbox.
10. **Deploy to hughesnode.com** — the product runs on a server, not just localhost.

### Strong Next-Phase Additions
11. **Subscriber management UI** — add/remove subscribers, see the list, import from CSV.
12. **Basic delivery stats** — sent count, failure count, displayed after each send.
13. **Newsletter name in all GPT prompts** — subject line generator, story writer all reference the actual newsletter name.
14. **"Run again" button** — after publishing, one click to start a new edition of the same newsletter with the same settings.
15. **Mobile-responsive editorial UI** — the React rebuild should be responsive from the start.
16. **Source inclusion/exclusion per category** — let users whitelist or blacklist specific domains.

### Later / Defer
17. Scheduled/automated runs (cron-style)
18. Public newsletter archive pages
19. Open rate / click rate analytics
20. Multi-user / team support
21. Newsletter discovery / marketplace
22. Custom MJML template editor
23. Subscriber growth tools (referral, recommendations)
24. API access for programmatic newsletter creation
25. White-label / custom domain support

---

## 5. User and Workflow Expansion

### Personal User (creating for themselves)
**Wants:** Minimal friction. Pick a topic, get a newsletter, read it.
**Workflow:** Pick preset or create custom → Start pipeline → Quick review (maybe skip editing) → Send to self
**Flexibility level:** Low. Wants the fast path. Might not even edit stories.
**V3 implication:** The "fast path" must remain fast. Don't force users through all three phases if they just want to read the output.

### Analyst/Operator (recurring briefings)
**Wants:** Consistent quality, recurring schedule, source control, audience-appropriate tone.
**Workflow:** Open existing newsletter → Start new edition → Review candidates carefully → Edit headlines and text → Style → Send to distribution list
**Flexibility level:** Medium. Wants to control sources and tone. Will use the "Show search details" toggle. Will edit prompts.
**V3 implication:** Profile persistence, edition history, and audience-aware prompts matter most for this user.

### Publisher (newsletter for a distribution list)
**Wants:** Professional output, reliable delivery, subscriber management, brand consistency.
**Workflow:** Same as analyst but with more emphasis on styling, subject lines, and delivery reliability.
**Flexibility level:** Medium-high. Cares about theme, branding, subscriber list management.
**V3 implication:** SendGrid delivery must be rock-solid. Theme persistence per profile. Subscriber management UI.

### Editor (refining draft content)
**Wants:** Control over every word. Ability to rewrite, regenerate, reorder.
**Workflow:** Spends most time in Phase 2 (story editing). May regenerate sections multiple times. Edits headlines extensively.
**Flexibility level:** High. This is the power user of the editorial flow.
**V3 implication:** Phase 2 needs to be polished. Regenerate button feedback, inline editing, word count display all matter.

### Subscriber/Reader
**Wants:** A well-written newsletter in their inbox.
**Workflow:** Receives email. Reads it. Clicks links. Maybe unsubscribes.
**V3 implication:** Email rendering must be perfect across clients. Unsubscribe must work. This user never sees the platform UI.

### Anonymous Visitor
**Not in V3 scope.** No public pages, no archive, no discovery. This is a V4 concern.

---

## 6. Feature / Capability Grouping

### Identity & Accounts
- User registration and login (Supabase Auth)
- User profile (name, email)
- User owns their newsletter profiles and editions
- Session management

### Newsletter Persistence
- Newsletter profiles (name, audience, categories, objectives, theme)
- Edition history per profile
- Edition status tracking (in progress, awaiting review, delivered)
- Resume any edition from where you left off

### Newsletter Authoring & Editing
- Setup wizard with presets and custom creation
- Three-phase editorial flow (select → edit → style)
- Editable headlines in Phase 1
- Inline text editing and regeneration in Phase 2
- Theme/color picker in Phase 3
- Subject line selection and custom writing
- Custom search and manual story injection
- Source article URLs visible under each candidate
- News freshness selector
- Edition number override

### Scheduling & Automation
- V3: Manual trigger only ("Start New Edition" button)
- V4: Scheduled runs (daily, weekly, custom cron)
- V4: "Auto-draft" mode (pipeline runs automatically, user just reviews)

### Delivery & Subscribers
- SendGrid email delivery (tested, reliable)
- Subscriber list management (add, remove, import)
- Unsubscribe handling
- Delivery report (sent count, failures)
- HTML + plain text versions

### Archive / History / Discovery
- V3: Edition history sidebar (private, per-user)
- V4: Public newsletter archive pages
- V4: Newsletter discovery / browsing

### Analytics
- V3: Basic delivery stats (sent, failed, per edition)
- V4: Open rates, click rates (SendGrid webhooks)
- V4: Subscriber growth tracking
- V4: Cost trends over time

### Admin / Operations
- V3: Cost tracking per edition (already built)
- V3: Prompt Manager (view/edit/revert prompts)
- V3: Parallel AI Tuning Lab (debug search inputs)
- V4: Platform admin dashboard
- V4: Usage monitoring, rate limiting

---

## 7. First User Journey

**First visit to hughesnode.com:**
User sees a clean landing page. "Create AI-powered newsletters in minutes." Sign up button. Maybe a demo video or sample newsletter preview.

**Sign up:**
Email + password via Supabase Auth. Lands on a dashboard showing "You have no newsletters yet."

**First newsletter creation:**
Clicks "Create Newsletter." Sees preset cards (The Morning Signal, Tech Pulse, Energy Watch, etc.) and a "+ Custom Topic" option. Picks a preset or creates custom. Fills in name, audience, categories. Clicks "Start Pipeline."

**First pipeline run:**
Sees a progress indicator ("Discovering articles... Clustering stories..."). After ~20-60 seconds, lands in Phase 1 with 8-12 story candidates. Selects stories, maybe edits a headline. Clicks "Continue."

**First story editing:**
Sees each written story with full text. Reads through. Maybe regenerates one that's weak. Clicks "Continue."

**First newsletter styling:**
Sees the assembled newsletter in a preview. Picks a theme. Selects a subject line. Clicks "Approve."

**First send:**
If subscribers are set up: newsletter is sent. If not: user can download/preview the HTML. Either way, the edition is saved to history.

**Becoming a recurring user:**
Next week, user opens the dashboard. Sees their newsletter profile. Clicks "New Edition." The pipeline runs with the same categories and settings. The user is back in the editorial flow in under a minute. Over time, they tune their categories, adjust prompts, build a subscriber list.

**The key insight:** The first run should feel magical — "I described a topic and got a real newsletter." The second run should feel efficient — "I just clicked one button and I'm reviewing stories."

---

## 8. Key Assumptions to Challenge

### Public archive / discovery — too early
Building public newsletter pages, SEO, and discovery before you have 10 active users is premature. Focus on making the creation and delivery experience excellent first. Public pages are a growth feature, not a core feature.

### Multi-user complexity — too early
One user with multiple newsletters is the right V3 scope. Adding team collaboration, shared editing, role-based access, and multi-tenant data isolation is a massive lift that doesn't help until you have multiple paying users.

### Analytics depth — too early
Open rates and click tracking require SendGrid webhook integration, event processing, and dashboard UI. For V3, "it was sent to 47 people, 2 failed" is enough. Deep analytics is a retention feature for established users, not an acquisition feature.

### Creator-growth features — wrong product
Referral programs, recommendation engines, paid subscriptions, and audience growth tools are Substack/Beehiiv territory. This product's value is the AI pipeline, not audience building. Don't compete on their turf.

### Workflow abstraction — dangerous
Adding too many manual controls (drag-and-drop story ordering, custom section types, freeform layout editing) risks turning the product into a generic newsletter builder where AI is optional. The AI pipeline should remain the default and primary path. Manual controls should be escape hatches, not the main interface.

### Forcing all three phases — potentially too rigid
Some users (especially the "personal user" type) may want to skip Phase 2 (story editing) and go straight from selection to the final newsletter. Consider a "Quick Publish" option that skips the editing phase for users who trust the AI output.

---

## 9. Monetization View

### Is this something people would pay for?
Yes, if the output quality is consistently good and the workflow saves real time. The target user currently spends 1-3 hours per week curating news and writing a newsletter. If this product cuts that to 20 minutes, that's a clear value proposition.

### Who is most likely to pay?
1. **Analysts/operators producing recurring briefings** — they have a job to do and a deadline. Time savings = direct value.
2. **Small publishers with niche newsletters** — they're already investing time in content. This makes them faster.
3. **Professionals who want to look smart** — sending a well-curated briefing to your team/network has career value.

### What monetization model fits?
**Freemium with usage-based pricing:**
- Free tier: 2-4 newsletters per month, 1 newsletter profile, basic themes
- Paid tier ($15-25/month): Unlimited newsletters, multiple profiles, all themes, priority processing, subscriber management
- The API cost per newsletter (~$0.25) means the free tier costs you ~$0.50-1.00/month per free user. That's sustainable.

### What should NOT be prioritized early:
- Per-subscriber pricing (penalizes growth, feels punitive)
- Marketplace/transaction fees (no marketplace exists yet)
- Enterprise pricing tiers (no enterprise users yet)
- Annual plans (too early, need to prove monthly value first)
- Advertising or sponsorship features (wrong product DNA)

---

## 10. Critical V3 Use Cases

These are concrete workflows that V3 should support. They represent the real ways users will want to interact with the system beyond the basic "run pipeline, review, publish" flow.

### Use Case 1: Use My Own Sources Only
**Scenario:** A user has 5-10 specific article URLs they've already found. They don't want the system to search for articles — they want to skip discovery entirely and go straight to clustering and writing from their curated list.
**How it works:** In the setup wizard or Phase 1, the user pastes URLs (or uploads a list). The system fetches metadata for each, creates article records, and feeds them directly to the clustering step. No Parallel AI call needed.
**Guardrail:** This is an alternative entry point to the pipeline, not a replacement. The default path (AI-discovered articles) should remain the primary flow.

### Use Case 2: Blend My Sources with Discovered News
**Scenario:** A user wants the AI to discover articles as usual, but also wants to guarantee that 2-3 specific articles they've found are included in the pool.
**How it works:** The user adds their URLs during Phase 1 (manual story injection already exists in V2). The key improvement: these user-provided articles should be clearly marked and given priority consideration during clustering, not just appended as afterthoughts.
**V2 status:** Partially built. Manual story injection works but injected stories bypass clustering — they become standalone candidates. V3 should allow injected articles to participate in the clustering step alongside discovered articles.

### Use Case 3: Group Multiple Articles into a Single Story
**Scenario:** The user sees 3 separate story candidates in Phase 1 that are actually about the same topic. They want to merge them into one stronger story.
**How it works:** In Phase 1, the user selects multiple candidates and clicks "Merge." The system combines their source articles into a single candidate with a merged narrative summary. When GPT writes the story, it draws from all the combined sources.
**V2 status:** Not built. GPT does the grouping during clustering, but the user can't manually merge or split candidates after clustering.

### Use Case 4: Manually Curate a Story Cluster
**Scenario:** The user wants to create a story from scratch by picking specific articles from the discovered pool and grouping them together, rather than accepting GPT's clustering.
**How it works:** In Phase 1, the user sees all discovered articles (not just the clustered candidates) and can drag articles into custom groups. Each group becomes a story candidate.
**Guardrail:** This is a power-user feature. The default should remain GPT-clustered candidates. Manual curation should be an "advanced" option, not the primary interface.

### Use Case 5: Rerun One Section Without Rerunning the Whole Edition
**Scenario:** The user is in Phase 2 (story editing) and the lead story is weak, but the quick hits and watch list are fine. They want to regenerate just the lead story without re-running discovery or re-clustering.
**V2 status:** Partially built. The "Regenerate" button exists in Phase 2 and calls the story writer for just that section. V3 should ensure this works reliably and gives clear feedback.
**V3 improvement:** Allow the user to provide additional guidance when regenerating ("make it more analytical," "focus on the budget implications," "shorter and punchier").

### Use Case 6: Preserve and Import Proven V2 Prompt Assets
**Scenario:** V3 is being built. The developer needs to carry forward all V2 prompts, instruction patterns, and tuned behaviors without losing quality.
**How it works:** V2's `db-seed.ts` contains the canonical prompt texts. V2's `saved_prompts` table contains any editor-modified overrides. V3's migration should import these directly. The Prompt Manager's default/override/revert pattern should carry forward unchanged.
**Critical detail:** The prompts are not just text — they are a system. The clustering prompt's output format (sourceArticleIndices) feeds directly into the story writer's input format (sourceArticles array). Changing one without updating the other breaks the pipeline. V3 must preserve this chain.

### Use Case 7: Source Collections as a First-Class Concept
**Scenario:** A user who publishes a defense newsletter has a set of trusted sources they always want to prioritize: Defense News, Breaking Defense, USNI News, etc. They don't want to re-enter these every time. They want to define a "source collection" that's associated with their newsletter profile.
**How it works:** Each newsletter profile can have one or more source collections — named groups of domains that are either preferred (boosted in search) or excluded (blocked from search). These collections persist across editions and are applied automatically during discovery.
**V2 status:** The `preferred_sources` field exists on topic_config but is not wired into the Parallel AI objective. The `exclude_domains` list is hardcoded. V3 should make both user-configurable and persistent per profile.
**Distinction from filtering:** This is not just "include/exclude domains." It's a curated, named, reusable set of sources that reflects the user's editorial judgment about what sources are trustworthy for their topic. It's closer to an analyst's source list than a search filter.

---

## 11. Summary

### Product Strategy Summary
Build V3 as a single-user, deployed, account-based newsletter creation product. Keep the AI pipeline as the center of gravity. Add the infrastructure layer (auth, persistence, delivery, history) that turns the prototype into a real product. Rebuild the frontend in React for polish and maintainability. Deploy to hughesnode.com. Don't chase multi-user, analytics, or public pages until the core creation-to-delivery loop is excellent for one user.

### Recommended V3 Scope Boundary
V3 = V2's proven pipeline + user accounts + persistent newsletters + edition history + working email delivery + React frontend + deployed to a real URL. That's it. Everything else is V4.

### Most Important Product Decisions Before Building
1. **Single-user or multi-user?** Recommendation: single-user for V3. One account, multiple newsletters.
2. **React or keep vanilla JS?** Recommendation: React. The vanilla JS is at its limit.
3. **Deploy now or keep local?** Recommendation: deploy as part of V3. The product needs to be accessible from anywhere.
4. **How much of V2's backend to rewrite vs. adapt?** Recommendation: adapt. The services, pipeline, and database schema are solid. Rebuild the frontend and add the auth/persistence layer on top.
5. **Should the "fast path" allow skipping Phase 2?** Recommendation: yes, offer a "Quick Publish" option. Not everyone wants to edit every story.

### Warning: Ways V3 Could Accidentally Damage V2 Strengths
1. **Rebuilding prompts from scratch** instead of carrying forward the tuned V2 prompts. The prompt wording, instruction ordering, and minimum word counts were iteratively refined. Don't lose that.
2. **Making the default path slower** by adding required steps (onboarding flows, mandatory settings, forced tutorials). The magic of V2 is: pick a topic → get a newsletter.
3. **Abstracting the pipeline into a configurable workflow engine.** The deterministic sequence is a feature, not a limitation. Don't let users reorder pipeline stages or skip the clustering step.
4. **Deprioritizing the AI pipeline in favor of manual editing tools.** If V3 spends more effort on a rich text editor than on improving search quality and writing quality, the product loses its soul.
5. **Over-investing in subscriber/delivery features** before the creation experience is polished. The product's moat is the AI pipeline, not the email delivery. SendGrid handles delivery. The pipeline is what's unique.
6. **Losing the Parallel AI tuning insights.** The objective structure, the exclude_domains list, the excerpt size settings, the freshness filter — these were all discovered through testing. They should be preserved as configuration, not buried in code that gets rewritten.

---

*Written March 25, 2026. This document should guide V3 development alongside the V2 Lessons Learned and the V2 codebase as a reference baseline.*
