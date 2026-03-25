# Brainstorm Notes — Morning Signal V2

Captured during prototyping on March 24, 2026. These are ideas for improving the system, organized by priority and complexity.

---

## Problem: Not Enough Story Candidates

The first full pipeline run produced 7 story candidates from 34 articles. The design targets 8-15 candidates so the editor has plenty to choose from — ideally an abundance, so they can ignore weak ones and still have a full newsletter.

Two bottlenecks contribute to this:
1. **Parallel AI result count** — we're getting 6-10 results per category (34 total across 4 categories). More raw articles = more clustering options for GPT.
2. **GPT clustering prompt** — even with 34 articles, GPT only produced 7 clusters. The prompt could push harder for more granular grouping.

### Ideas to Get More Results (ranked by simplicity)

**A. Tune the clustering prompt (do now)**
The easiest fix. The current prompt says "8-15 candidates" but GPT consolidated aggressively. We can:
- Emphasize that each article can be its own candidate if it's distinct enough
- Tell GPT to prefer more candidates over fewer, larger clusters
- Add "When in doubt, keep stories separate rather than merging them"
- This costs nothing extra and doesn't change the Parallel AI side at all

**B. Increase max_results per category (do now)**
We're requesting 10 results per category. Parallel AI supports up to 20. Bumping to 15-20 would give us 60-80 raw articles instead of 34. More raw material = more candidates. The cost increase is minimal (still 4 API calls, just bigger responses).

**C. Add more search queries per category (do now)**
Each category currently has 3 keyword queries in the `search_queries` array. Adding more specific queries (e.g., "defense budget 2026", "military drone contracts", "NATO expansion") gives Parallel AI more angles to find articles. Free — same API call, just more keywords.

**D. Supplemental search on low results (do later)**
If a category returns fewer than X articles, automatically run a second Parallel AI call with a slightly different objective or broader keywords, then merge and deduplicate. This is the "run again with modified search" idea.

Concern: as noted, this complicates the ranking system since results from two calls have independent rank orderings. Mitigation: treat the second call's results as lower-priority (append after first call's results) so the original ranking is preserved for the primary results.

**E. Let the editor trigger "find more" per category (do later)**
In the editorial UI, if a category looks thin, the editor clicks "Find More" and the system runs an additional search for that category. Similar to custom search but category-scoped. This keeps the editor in control rather than automating it.

---

## Idea: Multi-Topic Newsletter Platform

The bigger vision: this tool shouldn't be locked to defense/energy/tech. A user should be able to create a newsletter about any topic — crypto, healthcare, local politics, sports tech, whatever.

### How This Could Work

**Newsletter Profile / Setup Wizard**
When a user creates a new newsletter, they go through a simple setup:
1. **Name your newsletter** — "The Morning Signal", "Crypto Weekly", "HealthTech Digest"
2. **Describe your audience** — "Senior defense officials" or "Startup founders interested in AI"
3. **Pick your topic categories** — user defines 2-6 categories with display names
4. **For each category, describe what to look for** — free text that becomes the Parallel AI objective
5. **Suggest preferred sources** (optional) — user can list domains they trust

The system translates this into:
- Topic configs in the database (already supported — `topic_config` table)
- Per-category Parallel AI objectives (already supported — `buildObjective()` just needs to read from DB instead of hardcoded strings)
- Audience description injected into GPT prompts (already a template variable)

### What's Already Built That Supports This
- `topic_config` table with `category`, `display_name`, `search_queries`, `priority`, `is_active` — this is already designed for multiple configurations
- Prompt Manager with editable prompts per stage — audience/tone can be customized
- The Parallel AI Lab UI already lets you edit objectives and queries per category

### What Would Need to Change
- **Newsletter profiles table** — store multiple newsletter configurations (name, audience, tone, categories)
- **Objective builder reads from DB** — instead of hardcoded `buildObjective()`, pull the objective template from the newsletter profile
- **Setup wizard UI** — a simple form that walks the user through creating a newsletter profile
- **GPT prompts reference the profile** — audience description, tone, newsletter name all come from the profile instead of hardcoded "The Morning Signal"

### When to Build This
Not now. The current hardcoded Morning Signal setup is the right prototype. But the architecture already supports it — the `topic_config` table, the prompt manager, and the configurable objectives are all the right foundation. When we're ready, it's mostly a UI + database layer on top of what exists.

---

## Priority Recommendation

**Do now (during prototyping):**
1. ~~Tune the clustering prompt to produce more candidates (A)~~ DONE — added instruction 8: present unclustered articles as single-source candidates, aim for higher end of 8-15
2. ~~Bump max_results to 15 per category (B)~~ DONE — changed from 10 to 15
3. Add more search queries per category (C) — update seed data
4. ~~Show source article URLs in editorial UI~~ DONE — expandable "View source articles" section on each candidate

**Do next iteration:**
4. Supplemental search on low results (D)
5. "Find more" button per category in editorial UI (E)

**Do when ready to expand beyond Morning Signal:**
6. Newsletter profiles + setup wizard
7. Dynamic objective builder from profile

---

## Idea: Edition Sidebar + Authentication

**Edition Sidebar**
Replace the "Resume an existing edition" text input with a sidebar that lists all past editions. Each entry shows the edition number, date, status (awaiting selection, awaiting review, delivered, etc.), and the lead story headline. Click one to jump right into it. This makes the tool feel like a real workspace instead of a one-shot pipeline.

**Authentication**
Once there's a sidebar showing editions, you need login so that only the person who created an edition can access it. This also becomes essential for the multi-newsletter platform idea — each user has their own newsletters and editions.

Options (simplest to most robust):
- Simple password gate (single shared password for the whole app) — quick prototype
- Supabase Auth (built into our existing Supabase setup) — proper user accounts, email/password or magic link
- OAuth (Google/GitHub login) — most user-friendly but more setup

Supabase Auth is probably the right call since we're already on Supabase. It would add a `user_id` column to the `editions` table so each edition belongs to a user.

**When to build:** After the core editorial flow is solid. The sidebar is a quick UI win. Auth is a bigger lift but necessary before sharing the tool with anyone else.

---

## Idea: Three-Phase Editorial Workflow

The current flow is: Story Selection → Content Review. The user wants to add more editorial control between those steps. The new flow would be:

**Phase 1: Story Selection** (exists today)
- Pick which stories to include, assign roles (lead, quick hit, watch list)
- NEW: Let the user manually type/edit the headline for each selected story before writing begins
- This gives GPT a better headline to work from, or lets the editor override the AI-suggested one

**Phase 2: Story Editing** (new)
- After GPT writes all the stories, show each story individually with its full text
- Let the user edit the text of any story directly (inline editing)
- Let the user regenerate a story if they don't like it
- Let the user reorder stories within their section
- This is where the editor fine-tunes the content before it goes into the newsletter template

**Phase 3: Newsletter Editing** (new — replaces current Phase 2)
- Show the assembled newsletter in the email template
- Let the user change the theme/color/style of the newsletter (color scheme, fonts, header style)
- Let the user pick the subject line
- Desktop/mobile preview toggle
- Final approve/reject

This is a cleaner separation of concerns:
- Phase 1 = what stories
- Phase 2 = what the stories say
- Phase 3 = how the newsletter looks

### Theme/Style System
The newsletter is built with MJML, which supports variables for colors, fonts, and spacing. We could offer:
- Preset themes (e.g., "Professional Dark", "Clean Light", "Government Blue")
- Custom color picker for header, accent, background, text colors
- Font selection (limited to email-safe fonts)
- These settings would be stored per newsletter profile and applied during assembly

### Implementation Approach
- Phase 2 (story editing) is mostly a UI change — the backend already supports editing sections via POST /edit-section
- Phase 3 (newsletter editing) needs theme variables added to the MJML template and a theme picker UI
- The headline editing in Phase 1 is a small UI addition — add an editable text field next to each selected story

### When to Build
This is the next major feature after the custom topic work. The three-phase flow makes the tool feel much more like a real editorial product.

---

*These notes are for reference. When we're ready to implement any of these, we can create proper spec tasks.*


---

## Idea: User-Defined Newsletter Topics (Custom Topic Flow) — ACTIVE

*Replaces the earlier "Multi-Topic Newsletter Platform" idea with a concrete design.*

### The Problem
Search inputs (objectives, search queries, excluded domains) are hardcoded for defense/energy/tech/policy. We want any user to create a newsletter about any topic. But the Parallel AI inputs that produce good results aren't intuitive — phrases like "NOT website homepages, section landing pages" and specific source preferences are things we figured out through testing, not things a user would naturally write.

### Design Decision: Two-Layer Input

**Layer 1 (what the user sees):** Simple, friendly inputs
- Newsletter name
- Audience description ("Who reads this?")
- Topic categories (user defines 2-6 categories with names)
- For each category: a plain-English description of what to look for + optional preferred sources
- Days back (how recent)

**Layer 2 (what Parallel AI gets):** The system wraps the user's input in our proven prompt structure
- The "find specific articles, NOT homepages" boilerplate gets added automatically
- The user's category description becomes the topic-specific part of the objective
- The user's preferred sources get appended
- Excluded domains (linkedin, facebook, etc.) are applied automatically
- The user CAN see and edit the full generated objective if they want (advanced/transparency mode)

This way a user can type "cryptocurrency regulation and DeFi developments" and the system wraps it into a proper Parallel AI objective without the user needing to know the magic words.

### Default Presets
Presets are pre-built newsletter configurations that fill in all the fields. When a user picks a preset:
- All fields get populated with the preset values
- The user can see exactly what the preset contains
- The user can modify any field before creating
- This teaches users what good inputs look like

Presets to ship with:
- **The Morning Signal** — defense, energy, technology, policy (our original)
- **Tech Pulse** — AI/ML, cybersecurity, cloud, startups
- **Energy Watch** — oil & gas, renewables, grid, nuclear, climate policy
- **Capitol Brief** — legislation, executive orders, regulatory, elections
- **Global Markets** — equities, forex, commodities, central banks

### UI Flow
The start screen becomes a "Create Newsletter" flow:
1. Pick a preset OR start blank
2. If preset: fields populate, user reviews and can edit anything
3. If blank: user fills in name, audience, categories
4. "Show search details" toggle reveals the raw Parallel AI objectives (transparency)
5. Save → creates the newsletter profile → starts the pipeline

### Key Principle
The user should always be able to see what's being sent to Parallel AI. No black boxes. But the default view should be simple and friendly, with the technical details available on demand.
