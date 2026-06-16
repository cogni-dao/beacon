# beacon growth-loop v0 — spec (Twitter + Moltbook, text-only)

## 1. The loop — a compounding growth loop, not a flat funnel

Flat "GENERATE→BROADCAST→MEASURE→REFINE" hides the two things that make marketing work: a growth *loop* whose output (validated learnings + grown audience) reinvests into its input (Balfour/Reforge — loops compound, funnels leak), and a real content-production *sub-loop* where ideas are planned, drafted, edited, and adapted per platform. v0 models both, minimally.

### Outer growth loop (slow, compounding) — strategy & learning
1. **PLAN (strategy/funnel)** — audience + **funnel stage** (TOFU awareness / MOFU consideration / BOFU conversion) + objective → a **campaign hypothesis**: "angle A for audience X at stage S hits engagement-rate target T within budget B." *Recalls* `beacon-brand-voice` to seed angles.
2. **IDEATE** — expand the brief into a few distinct **angles/hooks** (core ideas).
3. **PRODUCE** — inner content loop (below) → ready per-platform posts.
4. **BROADCAST** — distribute the per-platform variants.
5. **MEASURE** — cache real engagement (decoupled cadence).
6. **ATTRIBUTE** — independent KPI scores each post / angle / platform.
7. **LEARN** — distill winners into `beacon-brand-voice`; resolve the campaign hypothesis. → feeds the next PLAN. Output reinvests as input = compounding.

### Inner content loop (fast, per idea) — where drafts/edits/adaptation happen
- **a. DRAFT** for one angle → **b. CRITIQUE→EDIT** (1 self-revise pass in v0; optional human approve/refine in lens) → **c. ADAPT per platform** (core idea → X ≤280 hook-first; Moltbook its format) → **d. STAGE** as `drafted`→`approved` broadcasts rows.

**Architecture mapping (no new infra):** PLAN = campaign-start API + EDO hypothesis + brief. IDEATE+DRAFT+CRITIQUE+ADAPT = `langgraph:content` as a 4-node graph. STAGE/approve = `broadcasts.status` + lens. BROADCAST = broadcast tool. MEASURE = ingest job. ATTRIBUTE = independent resolver (groups by `idea_key`+channel). LEARN = resolver distills a brand-voice rule + resolves the hypothesis.

## 2. Substrate reality (corrected) & OSS

- **EDO substrate is built+tested for the `agent` strategy + manual `recordOutcome`** (`packages/knowledge-store`). A campaign reuses the `hypothesis` row — **no new goal table**.
- **The `metric:` resolution strategy is documented-but-UNIMPLEMENTED** (`packages/knowledge-store/src/domain/schemas.ts:99` lists `metric:<query>` as a future kind; the resolver handles only `agent`; `pendingResolutions(strategy)` already filters by `LIKE 'metric:%'` but nothing computes a metric edge, and it is driven from nowhere but tests). **PR 3 therefore owns NEW resolver wiring in `packages/knowledge-store`** — a `metric:`-strategy resolver + the driver that calls `pendingResolutions("metric:") → compute edge → resolveHypothesis(edge)` — not merely the pure KPI function.
- **OSS:** `twitter-api-v2` (typed X v2 client) — real X adapter. **Moltbook = fake-only in v0** (no verified public client/API; real adapter deferred to a flagged follow-up once its API is confirmed). Reuse in-repo: **LangGraph** (generate), **Temporal** (cadence), **Drizzle + Dolt/Doltgres**, **LiteLLM** (models), **Zod/Pino→Loki**, **Tavily web-search** as the exact capability/adapter/fake/factory template. v1 (deferred): **Postiz/Mixpost** (OSS multi-channel "channels=config"), **PostHog** (OSS funnel attribution).

## 3. Postgres tables (3) — `packages/db-schema/src/beacon-growth.ts`
No-RLS-v0 / service-role per `attribution.ts` precedent; tenant col present for future RLS; migration via **`schema-update` skill**.
1. **`channel_accounts`** `(id, channel['x'|'moltbook'], handle, credential_ref, enabled, created_at)`.
2. **`broadcasts`** `(id, campaign_id, idea_key, angle, channel, text, status['drafted'|'approved'|'posted'|'failed'], external_post_id, posted_at, created_at)` — `idea_key` groups per-platform variants; `status` = draft→approve→post lifecycle. *(Add `creative_assets` media table when images land — next step.)*
3. **`post_metrics`** append-only `(id, broadcast_id, channel, captured_at, impressions, likes, reposts, replies, followers_at_capture)` — cached KPI ground-truth; written ONLY by the ingest path.

## 4. Knowledge domains (3, Doltgres, cited)
1. **`beacon-campaigns`** — hypotheses (`metric:engagement`) + outcomes.
2. **`beacon-post-performance`** — per-post/angle findings → `evidence_for` the campaign.
3. **`beacon-brand-voice`** — durable rules (winning hooks/angles/formats/timing per audience+channel); every PLAN recalls it.

## 5. v0 metric — precise
Primary independent KPI = **engagement rate** = `(likes+reposts+replies)/impressions` from X v2 `public_metrics` (+ Moltbook equiv), aggregated per campaign → normalized **0–100** vs target. **X-tier assumption:** Basic+ exposes `impressions`; **free tier hides impressions**, so the adapter falls back to `engagement_per_follower = (likes+reposts+replies)/followers_at_capture`, pinned by which fields the adapter actually receives. Secondary: follower **delta**. **PostHog = v1.**

---

## 6. Subagents — one self-contained spec per PR (sequential; merges held per §0)

### PR 1 — `foundation` (substrate + framing)
- **Owns:** `packages/db-schema/src/beacon-growth.ts` (§3 tables) + barrel; migration (schema-update skill + generate-clean gate); `docs/spec/beacon-growth-loop-v0.md` (this spec); root `AGENTS.md` → growth-engine mission; `.cogni/rules/repo-goal-alignment.yaml` `clear-purpose` → growth-loop; register 3 Doltgres domains.
- **I/O before→after:** before — no growth tables/domains/mission; after — substrate + domains exist; repo-goal gate scores the mission correctly.
- **Validation / done:** `pnpm check` + generate-clean green; migration in `meta/_journal.json`; no behavior change; CI green; PR open (merge held).

### PR 2 — `studio` (Produce → Broadcast → Measure)
- **Owns:** capability iface `packages/ai-tools/src/capabilities/social-x.ts` (`postContent`,`readMetrics`, Zod, pin X v2) — **shared package, multi-runtime** (mirrors `web-search.ts`); real adapter `app/src/adapters/server/social/x.adapter.ts` (`twitter-api-v2`, env-gated off) + fakes `app/src/adapters/test/social/{x,moltbook}.fake.ts` (deterministic monotonic-rising engagement); factory `app/src/bootstrap/capabilities/social-x.ts`; secret via `/add-secret`. `packages/langgraph-graphs/src/graphs/content/*` 4-node graph (ideate→draft→critique→adapt), registered in **`packages/langgraph-graphs/src/catalog.ts` (`LANGGRAPH_CATALOG`)** (+ optionally the `AVAILABLE_GRAPHS` UI picker). `core__broadcast_post` tool → writes `broadcasts` (per-channel variants by `idea_key`). `ingestPostMetrics.job` + token-gated `POST /api/internal/ops/growth/metrics-ingest` → appends `post_metrics`.
- **WORKER≠VERIFIER guard:** broadcast/content modules contain **no `post_metrics` writer**; ingest job is the sole writer. Enforced by module separation + a unit test asserting the broadcast tool's write surface excludes `post_metrics` (no dependency-cruiser in this repo — assert structurally in a test).
- **I/O before→after:** before — no draft/post/measure path; after — brief → per-platform drafts → (fake) posts in `broadcasts`; `curl` ingest fills `post_metrics`. No scoring.
- **Validation / done:** unit (graph emits one variant per enabled channel; broadcast tool persists external id; ingest appends snapshots; guard test) green; CI green; PR open.

### PR 3 — `verifier` (Verify → Refine → Surface) — the crux
- **Owns (incl. the corrected resolver bridge):** in `packages/knowledge-store` — a **`metric:`-strategy resolver** + pure `computeEngagementKpi(snapshots,target)→{score0to100,edge}` (no LLM/API; never reads the hypothesis's own confidence). In app — `resolveEngagementCampaigns.job` driving `pendingResolutions("metric:")` → load that campaign's `post_metrics` → `resolveHypothesis(edge)` (idempotent) + file a `beacon-post-performance` finding w/ `evidence_for` + distill a `beacon-brand-voice` rule on validate; token-gated `POST /api/internal/ops/growth/resolve`; `POST /api/v1/growth/campaigns` (PLAN: file hypothesis + content schedule, brief recalls brand-voice); thin `/growth` lens (mirror `/work`) + nav item.
- **I/O before→after:** before — posts+metrics exist but nothing scores/learns; after — campaign self-resolves from cached metrics → outcome + cited finding + brand-voice rule; `/growth` shows KPI vs target; `GET /api/v1/edo/chain/<id>` walks the proof chain.
- **Validation / done (deploy_verified, once operator repairs deploy):** unit `computeEngagementKpi` (score independence; budget→invalidates) + integration mirroring `edo-loop.test.ts` (ingest low → rising → resolve → `validates` + recomputed confidence). On candidate-a: start campaign → produce+post (fake) → ingest×2 → resolve → chain shows hypothesis ← finding(evidence_for) ← outcome(validates); lens shows lifted KPI; own request in Loki at deployed SHA; `/validate-candidate` scorecard.

## 7. Seed as Dolt knowledge (after operator gets beacon to prod)
Via `/contribute-knowledge-to-cogni`: add this spec to `beacon-campaigns`, entryType `rule`, confidence 70, tags `[growth-loop,v0,spec]`; open the contribution branch, merge once prod is green → durable, cited, recall-before-write knowledge for every future beacon agent.
