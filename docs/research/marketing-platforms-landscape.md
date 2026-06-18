# Research: Top-Tier Marketing Platforms, OSS & Workflows for a Self-Learning AI Marketer

> spike: beacon-growth-e2e | date: 2026-06-18 | author: research/review pass
> Source: 6-angle parallel web survey + adversarial verification (17 agents). Maps the
> 0.1% practices and OSS onto beacon's growth-loop spine. SSOT spec it reviews:
> [`beacon-growth-loop-v0.md`](../spec/beacon-growth-loop-v0.md).

## Question

What are the critical user workflows, UI/UX surfaces, and Postgres tables for a
self-learning AI marketing platform — and which top-0.1% practices + open-source
building blocks should beacon borrow (now for X/Moltbook text posts, vNext for AI
video clipping)? Where is beacon's genuine moat versus the incumbents?

## Context

beacon today is at **build-order step 1** of the spec: `campaigns` CRUD + a posts
queue (`broadcasts`) + `post_metrics` + a Dolt-hypothesis engagement-KPI resolver,
single-channel (Moltbook/X), text-only. Steps 2–7 (define → research → generate →
refine → post → analyze → autonomy) are unbuilt. The spec spine is
**DEFINE → RESEARCH → GENERATE → REFINE/RANK → POST → ANALYZE → LEARN**, autonomous-by-default
with an optional human approve-gate, and one safety invariant: *nothing reaches the
public except an `approved` row*. vNext is AI video clipping: upload a 5-min
talking-head → AI cuts N shorts → market research + analytics says what to make next.

**Headline finding:** beacon's spine is a near-exact **superset** of the dominant
pattern across every OSS scheduler (Postiz, Mixpost, Listmonk), every commercial AI
content tool (Blotato, ContentStudio, Jasper), and the canonical n8n content pipeline
(Trigger → Research → Generate → Approve → Publish → Log → Report). The market
*validates* the design. beacon's two real differentiators — an explicit RESEARCH stage
and a **funnel-layer (TOFU/MOFU/BOFU) generation axis** — are each shipped by ≤1 of 8
surveyed commercial tools. The one capability **no incumbent verifiably ships** is
autonomous "what to post/make next" planning; every "AI coach" on the market is
*reactive critique*. That gap is beacon's moat **and** its least-proven claim — so it
must be sequenced as a research bet *after* the proven primitives.

---

## Findings

### A. OSS social/marketing platforms (the data-model & queue precedents)

| Tool | License | Steal this |
|---|---|---|
| **Listmonk** | AGPL-3.0 | **Read first.** Cleanest primary-source schema in the space. Campaign status enum `draft→scheduled→running→paused/cancelled/finished`; the **aggregate-counter vs per-recipient-event split** (`campaign_views`, `link_clicks`) = exactly beacon's `post_metrics` + KPI-resolver shape (store raw events, aggregate on read); **resumable-send cursor** (`sent` + `last_subscriber_id`) for crash-safe POST. |
| **Postiz** | AGPL-3.0 | Single-post → **multi-channel fan-out** data model; 4-state machine `DRAFT→QUEUE→PUBLISHED\|ERROR` (ERROR terminal, needs manual retry); thread-as-comments; `intervalInDays` recurrence-on-read. (Uses Temporal — beacon already, correctly, dropped Temporal; copy the state machine, not the engine.) |
| **Mixpost Lite** | **MIT** | Per-account post **VERSIONS** (one logical post → per-channel content variants — directly the vNext one-clip→channel-specific-cuts model); "queue auto-fills next optimal slot" autonomous-cadence UX; platform-adapter pattern (abstract base + enum per network). |
| **Mautic** | GPL-3.0 *(verified — not AGPL)* | The **cron-driven tick** model: a periodic cron advances campaign membership + fires due actions — a simpler, Temporal-free loop driver. Lead-scoring "points" precedes beacon's REFINE/RANK score. |
| **Ghost / Postal** | MIT | Ghost = scheduled-publish + segmentation precedent (CMS, not a queue). **Postal** = inspectable outgoing-message queue (per-message status, manual requeue) — the model for beacon's failed-state UI. |

### B. Commercial AI content platforms (the workflow & "AI coach" precedents)

End-to-end workflow is universal: **idea → draft → variants → schedule → analytics →
iterate**. Key reads:
- **Brand voice as a durable, injected artifact** is the quality moat everyone ships
  (Jasper Brand Voice/IQ, Typefully, MagicPost creator-voice). beacon's DEFINE stage
  must make voice/ICP a *persistent object auto-injected into every downstream prompt*,
  not a per-post field.
- **Reactive critique is the only proven AI capability** (Blotato Coach, Jasper
  Optimization) — an LLM-as-judge critique→revise loop. **Predictive "what to post
  next" is NOT verifiably shipped by anyone.**
- Only **ContentStudio** (1 of 8) has a pre-generation research/discovery stage —
  beacon's RESEARCH stage is differentiated.

### C. n8n / automation templates (the workflow *shape*)

n8n is **fair-code (Sustainable Use License), not MIT/OSI** *(verified — a prior claim
that "templates are MIT" was refuted; community templates are shared, license varies)*.
The recurring, stealable workflow shapes:
- **Approve-gate is graph topology, not a flag:** every reviewed template puts the
  human gate as a discrete step, and the publish nodes are *only reachable downstream of
  it*. beacon should make POST literally unreachable except via an `approved` edge.
- **Two-phase RESEARCH:** cheap signal-scan (Google Trends/SerpAPI) → numeric-threshold
  filter → LLM **selects** one winner → *then* one expensive deep-research pass. Controls
  cost, lifts topic quality.
- **Normalize multi-source metrics to a unified schema before storing**, with a
  dedicated error sink for failed fetches.
- **Brand voice as an externalized composable system-prompt** (the publishing-factory
  templates store it in an editable doc injected into every call).

### D. Creator/agency growth frameworks (the strategy layer)

Durable principles beacon's DEFINE/GENERATE/REFINE must encode:
- **Volume = repurposing one hub, never N one-offs** (Welsh: 1 long-form → 6–12 posts;
  Hormozi: 1 idea → 80+/week). This is *literally* what vNext video clipping is
  (1 clip → N shorts) — same hub-and-spoke engine.
- **TOFU/MOFU/BOFU is a *metric* taxonomy, not just a content tag.** Reach judges TOFU,
  trust/lead-quality judges MOFU, conversion judges BOFU. ~68% of B2B deals stall in a
  chronically-starved MOFU → **deliberately over-weight MOFU** in `funnel_targets`.
- **Hook–Body–CTA is the atomic unit**; the first 2–3 seconds decide engagement (~65%
  who pass 3s reach 10s). Encode hook-type + CTA-type per layer.
- **Consistency ≈ 5× engagement** (Buffer, 100k+ users); gains front-load then diminish
  → steady cadence over bursty dumps; one missed week resets momentum.
- Encode **Hormozi's Value Equation** (dream outcome × likelihood ÷ time × effort) as a
  REFINE rubric lever.

### E. Self-learning / measure→learn loop

- **Log selection propensity, not just outcome.** The bandit/OPE tuple is
  `(context, action, reward, p)` where `p` = probability the policy chose that action
  (Vowpal Wabbit, Open Bandit Pipeline). Without `p`, you can only correlate, never
  counterfactually evaluate "would strategy B have beaten A?".
- **At low post volume, bandits starve** (sparse reward, cold-start). Prefer a
  *contextual* bandit that pools signal across posts; learn coarse levers first
  (posting-time → funnel-mix → angle → wording); use **CUPED + sequential/Bayesian
  testing** (GrowthBook) to detect effects with few posts and "peek" safely.
- **LLM-as-judge in a critique→revise→score loop** (Reflexion-style) = a learnable,
  automatable REFINE stage — the proven half of self-improvement.
- **Separate the engagement-prediction model from the action policy**, and calibrate
  *judge-predicted score vs realized KPI* — that gap is the core learning signal and the
  guard against a self-reinforcing judge.

### F. vNext AI video clipping pipeline

**Every stage except the feedback loop is solved in permissive-licensed OSS.** Pipeline
(transcript-as-source-of-truth, Descript model):

| Stage | What happens | OSS precedent (license) |
|---|---|---|
| Ingest + transcribe | Upload → **WhisperX** word-timestamps (±50ms) as the *canonical* artifact; clips are `(start_word, end_word)` spans → diffable like text drafts | WhisperX (**BSD-2**); OpenShorts faster-whisper |
| Detect candidate moments (GENERATE) | PySceneDetect + interpretable weighted-signal scoring → ~2–5 candidate clips per 5-min input (never one) | SamurAIGPT Classify/Chunk/Rank/Dedupe DAG (**MIT**); Vizard signal stack |
| Cut + reframe 9:16 (dual-mode) | FFmpeg cut at word boundaries; **TRACK** (face/pose + smoothed camera path) vs **GENERAL** (saliency/blurred-bg) fallback. Jitter is the #1 failure | OpenShorts dual-mode; auto-vertical-reframe (**MIT**); pyautoflip (**Apache**). **AVOID Ultralytics YOLO — AGPL-3.0, viral for SaaS** |
| Caption | ASS per-word karaoke from Whisper timestamps, burned via FFmpeg — fully commoditized | cutcaption / clipify (**MIT**, local) |
| Score virality (REFINE) | 0–100 score with **named sub-signals** (hook/flow/value/trend) — same shape as beacon's text score | Opus Clip Virality Score |
| Approve-only render + post | Only an **approved** span renders + ships — reuse the safety invariant unchanged; B-roll stays human-gated | OpenShorts publisher; beacon's own approved-only queue |
| Measure + recommend next (LEARN — **the moat**) | Per-clip engagement → which sub-signals/topics drove it → Doltgres "next topic" at **demand × low-supply × proven-on-voice** | vidIQ Daily Ideas (discovery) — **no tool ships the verified score→realized-engagement loop** |

Closest architectural match to beacon's stack: **OpenShorts** (MIT) — FastAPI worker +
React + S3 + async job queue + publisher.

---

## The four product answers

### 1. Critical user workflows (each mapped to a spine stage)

1. **DEFINE** — Set the campaign as durable strategy (voice + core_topic + ICP +
   objective + autonomy mode). A persistent, versioned artifact auto-injected into every
   downstream prompt — not a per-post field. *(Jasper IQ pattern.)*
2. **RESEARCH** — Two-phase grounding: cheap discover → filter → LLM-select → one deep
   pass → tenant-private `research` rows. *(beacon's clearest differentiator.)*
3. **GENERATE** — Fill a funnel of drafts on a **layer × channel matrix** toward
   `funnel_targets` (no hardcoded N), Hook–Body–CTA template, MOFU over-weighted.
4. **REFINE/RANK** — Critique → revise (bumps `revision`) → score on a *named rubric* →
   approve/reject. Human gate optional (`approve_gate`); agent default (`autonomous`).
5. **POST** — Cron `/tick` **drains** highest-score approved rows on a cadence
   (decoupled from approval-time); idempotent/resumable cursor; dumb shipper.
6. **ANALYZE** — Parallel-fetch metrics → normalize → append snapshots → resolve KPI
   **per funnel layer with layer-appropriate metrics** (TOFU=reach, MOFU=trust,
   BOFU=conversion), *not one global rate*.
7. **LEARN** — Tier-1 (ship first, proven): evergreen-recycle high-KPI rows. Tier-2
   (research bet): distill generic playbook into Doltgres, gated by off-policy eval.

### 2. UI/UX scaffolding

| Surface | Purpose | Borrows from |
|---|---|---|
| `/growth` campaigns list | Lifecycle status pills + autonomy badge + funnel-coverage-vs-target gauge + next-tick-due | Listmonk status pills; Buffer/Sprout dashboards |
| Campaign detail — posts by lane (v0 grouped list; Kanban vNext) | The main workspace: drafts by status lane, per-card hook/score/layer/revision, one-click approve/reject | Taplio Kanban; ContentStudio approvals |
| Define-campaign form | Capture voice/topic/ICP/objective + per-layer `funnel_targets` sliders + autonomy selector (plain-English gates) | Jasper Brand Voice; n8n brand-voice doc |
| Inspectable post queue w/ failed-state + manual requeue | Operator debugging + safety: see pending/posted/failed, retry stuck sends | Postal queue; Postiz ERROR retry |
| Per-layer analytics panel (NOT one global number) | TOFU/MOFU/BOFU each by its own KPI + predicted-vs-actual delta + evergreen-recycle flags | funnel.io/Semrush; Hypefury "mark winner" |
| *vNext:* clip-review (transcript-as-truth) | Review candidate clips by editing the transcript; per-clip sub-signal breakdown; approve gate before render | Descript Underlord; Opus Clip |
| *vNext:* "what to make next" brief | Ranked next-topic cards at demand × low-supply × on-voice; one-click start-campaign | vidIQ Daily Ideas |

### 3. Critical Postgres tables

| Table | New/existing | Purpose & key columns |
|---|---|---|
| `campaigns` | **extend** | DEFINE record. Add `voice, core_topic, icp, objective, funnel_targets(jsonb), autonomy[manual\|approve_gate\|autonomous]` to live `(campaign_id,title,brief,target_rate,status,evaluate_at)`. |
| `research` | **new** | Tenant-private grounding: `(account_id, campaign_id, kind[icp\|use_case\|pain_point\|topic\|competitor], content, source_ref)`. |
| `posts` (rename `broadcasts`) | **extend** | THE QUEUE. Add `score, revision`, richer status lanes (adopt Listmonk superset: `generated\|in_review\|approved\|posted\|rejected\|failed` + `paused/cancelled`, terminal `failed` needs manual retry). Keep `idea_key` for vNext multi-channel fan-out. |
| `post_metrics` | **existing** | Keep append-only snapshots; KPI resolver must read **per-layer** + aggregate on read; impressions nullable on X free-tier → fall back to engagement-per-follower. |
| `channel_accounts` | **existing** | No v0 change; Mixpost adapter pattern when multi-channel arrives. |
| `post_decisions` | **new, tiny** | **Add NOW (near-zero cost).** `(post_id, context(jsonb), propensity(real), policy_version)` — the precondition for rigorous LEARN/OPE. Skip it and LEARN rigor is permanently capped. |
| `clip_jobs` *(vNext)* | new | Durable, GPU-aware, resumable: one row per **stage** per clip `(upload_id, stage, status, artifact_ref(S3), error)`. |
| `clips` *(vNext)* | new | `(upload_id, start_word_idx, end_word_idx, virality_score, score_subsignals(jsonb), status)`; becomes a `posts` row only when approved. |

---

## Recommendation

1. **Land the pending DEFINE migration (spec step 2) next** — it resolves live
   spec/schema drift (`broadcasts`→`posts`, Dolt-hypothesis KPI → Postgres) that
   compounds the longer it waits. Use the `schema-update` skill (RLS-first + FORCE +
   component gate).
2. **Adopt Listmonk's data shapes wholesale** (status superset, raw-event-vs-aggregate
   split, resumable cursor) — read-only (AGPL); don't vendor code.
3. **Make per-layer KPI resolution the single highest-leverage correction** — the funnel
   framework's central demand; the current global engagement rate is wrong for a funnel.
4. **Add `post_decisions` (propensity + context) immediately** — cheap now, impossible
   to backfill, gates all future LEARN rigor.
5. **Sequence LEARN: evergreen-recycle (proven) before autonomous planning (the bet).**
   Don't let the roadmap depend on the unproven moat landing.
6. **vNext video = a separate worker service** (FastAPI-style + S3 + per-stage job
   queue), reusing the approved-only invariant. Borrow OpenShorts/WhisperX/SamurAIGPT
   (permissive); the score→real-engagement loop is the uncontested moat.
7. **License discipline:** Postiz/Listmonk (AGPL), Mautic (GPL), Ultralytics YOLO (AGPL)
   are **read-only references** — beacon is proprietary (PolyForm-Shield). Vendor only
   MIT/BSD/Apache (Mixpost-Lite, WhisperX, OpenShorts, MediaPipe, pyautoflip).

## Open questions

- **Loop driver:** spec says k8s CronJob `/tick`; confirm beacon's deploy can host a
  self-firing CronJob proven in Loki (Mautic/Listmonk/Mixpost all prove cron-tick + queue
  worker runs a full loop with no workflow server).
- **Metric API reliability:** X/Graph APIs are increasingly paid/rate-limited and
  impressions often null — what's the fallback contract for ANALYZE?
- **Contextual-bandit substrate:** wrap Vowpal Wabbit / OBP as a service, or implement a
  thin in-house contextual scorer first? (volume is too low for per-arm bandits.)
- **vNext infra:** beacon lacks S3-style object storage + a GPU async job queue today —
  net-new infra; scope as its own service, not bolted onto the Next.js/Postgres core.
- **Re-verify before copying specifics:** some findings lean on secondary sources;
  verification refuted two (Mautic = GPL not AGPL & MySQL-only not Postgres; one n8n
  template uses OpenAI not Claude). Confirm any data model against primary source.

## Proposed layout (development roadmap)

Directional, not binding. Each phase is one demoable increment; phases 0–5 follow the
spec build-order, phase 6 is vNext.

| Phase | Goal | Demoable outcome |
|---|---|---|
| **0 — DEFINE** | Land spec step 2 migration: extend `campaigns` (voice/core_topic/icp/objective/autonomy/funnel_targets), rename `broadcasts`→`posts`, add lanes/score/revision. One migration via `schema-update`. | Create a campaign with full strategy + autonomy; posts table carries lanes + score + revision. |
| **1 — RESEARCH** | `research` table + 1-pass discover→filter→select→deep-research workflow. | Trigger research; rows populate and ground the brief in UI. |
| **2 — GENERATE + REFINE** | N-draft generate (layer×channel toward `funnel_targets`, Hook–Body–CTA, MOFU-weighted) → critique→revise (1–2 passes, named rubric) → score → approve (agent default; human gate when `approve_gate`). POST unreachable except via approved edge. | From a brief, beacon drafts a funnel, refines+scores, human approves/rejects in lane UI. |
| **3 — POST** | k8s CronJob `/tick` drains approved-only to Moltbook; idempotent cursor; inspectable failed-state + requeue. | Approved post auto-publishes via self-firing tick; Loki shows cron; failed sends requeue-able. |
| **4 — ANALYZE + LEARN tier-1** | Per-layer KPI resolver (source = Postgres); add `post_decisions` (propensity+context) NOW; evergreen-recycle high-KPI rows; GrowthBook CUPED for low volume. | Per-layer KPI panel; a winner auto-flagged + recycled. |
| **5 — AUTONOMY + LEARN tier-2** | `/tick` advances each active campaign per autonomy mode; distill Doltgres playbook gated by off-policy eval (OBP IPW/DR over `post_decisions`); track judge-vs-realized calibration. | Autonomous campaign runs define→…→learn unattended; playbook change promoted only after OPE beats incumbent. |
| **6 — vNext video** | New worker service + S3 + `clip_jobs` + `clips`. WhisperX→detect→FFmpeg cut+dual-reframe→ASS caption→virality score→approved-only render+post→per-clip metrics→"next topic". B-roll human-gated. | Upload 5-min clip → ~2–5 captioned 9:16 candidates w/ scores → approved clip renders+posts → analytics recommends next topic. |

## Risks (carried into the design review)

- Autonomous "what to make next" is **unproven by any incumbent** — moat *and* biggest
  risk; sequence after evergreen-recycle.
- **Low volume starves bandits** — use contextual pooling + CUPED, learn coarse levers
  first, or the loop chases noise.
- **Skipping `post_decisions` now permanently caps LEARN** (cannot backfill propensity).
- **Self-reinforcing judge** — calibrate predicted-vs-realized or the loop converges on
  "judge likes what generator makes".
- **License contamination** — AGPL/GPL refs are read-only; beacon is proprietary.
- **Metric APIs unreliable/paid** — don't hard-depend on impressions.
- **vNext = net-new infra** (S3 + GPU job queue) — separate service, real scope.
- **Auto-B-roll/AI visuals** are unreliable *and* a safety risk — strictly human-gated.
- **Spec/schema drift** — `beacon-growth.ts` docstring + AGENTS.md still reference
  Temporal + the Dolt hypothesis + old loop vocab (`PLAN→IDEATE→…`); land phase 0 to stop
  the drift compounding.
</content>
