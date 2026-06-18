# beacon growth-loop — design (v0)

> Single source of truth. Supersedes every prior scratch doc (all purged).
> v0 is the **kernel** of a full-stack AI marketing tool. The long tail (RBAC,
> research/competitor pipelines, multi-channel, analytics depth) is deliberately
> out of scope — see §7.

## 0. What beacon is
An AI marketer that runs a compounding, **autonomous-by-default** loop per campaign:

**DEFINE** (voice + core topic + ICP) → **RESEARCH** (spawn marketing-research
workflows) → **GENERATE** (N drafts, never one-off) → **REVIEW/REFINE** (iterate +
rank + approve) → **POST** (approved-only) → **ANALYZE** (KPI → re-rank → learn) ↺.

A campaign is **strategy**, not a single post: a human (or guided agent) sets the
voice + core topic + audience; beacon then researches, drafts at volume, refines,
and publishes — and the operator can let it **run autonomously** or steer any stage
**on demand**. Autonomy is the core; on-demand is a capability, never the limiter.
v0: one channel (**Moltbook**), single account per tenant.

## 1. The split: Postgres vs Doltgres (the foundational rule)

| | **Postgres** | **Doltgres (knowledge hub)** |
|---|---|---|
| Holds | tenant-private **operational truth** | app-wide **generic knowledge** |
| Examples | campaigns, the post queue, metrics, channel creds | "how the system works" + the most effective *skills/strategies* for campaigns, platforms, analytics, brand-voice |
| Scope | every row `account_id`-scoped, **RLS + FORCE** | **no tenant data, ever** (RLS-Dolt is someday) |
| Question it answers | "what is **this tenant** doing?" | "what **works**, in general?" |

**The rule:** if a row names a specific account / campaign / post, it's **Postgres**.
If it's a reusable strategy/skill/playbook the AI could apply to *any* tenant, it's
**Doltgres**. At runtime the AI **recalls generic Dolt knowledge and applies it,
customized, to a tenant's Postgres campaign** — Dolt is the playbook, Postgres is the
game. (Today's campaign hypothesis must move **out** of Dolt into Postgres — see §2/§8.)

## 2. Postgres tables (`packages/db-schema/src/beacon-growth.ts`)
All `account_id`-scoped, `pgPolicy("tenant_isolation")` + FORCE RLS, proven by the
component lane.

1. **`campaigns`** = the **strategy** (DEFINE) `(id, account_id, campaign_id, title, status['draft'|'active'|'paused'|'done'], voice, core_topic, icp, objective, target_rate, funnel_targets, autonomy['manual'|'approve_gate'|'autonomous'], evaluate_at, created_at)` — voice + core topic + ICP + objective drive everything downstream. `funnel_targets` = desired live coverage **per funnel layer** (the tunable that drives generation volume — no hardcoded N). `status` is a **plain Postgres field that gates the queue** (no schedule coupling). `autonomy` sets how far it self-runs (§3). *(Doltgres hypothesis removed — §8.1.)*
2. **`research`** *(tenant artifacts)* `(id, account_id, campaign_id, kind['icp'|'use_case'|'pain_point'|'topic'|'competitor'], content, source_ref, created_at)` — the output of the RESEARCH workflows that grounds generation. Tenant-private (it's *this* campaign's research); the generic research *methods/skills* are recalled from Dolt.
3. **`posts`** *(rename of `broadcasts`)* `(id, account_id, campaign_id, funnel_layer, topic, angle, channel['moltbook'|'x'], text, score, revision, status['generated'|'in_review'|'approved'|'posted'|'rejected'|'failed'], external_post_id, posted_at, created_at)` — **THE QUEUE.** `status` = the lane; `score` = ranking signal; `revision` tracks refine passes (generation is iterative, never one-off).
4. **`post_metrics`** append-only `(id, account_id, post_id, captured_at, impressions, likes, reposts, replies, followers_at_capture)` — cached engagement; **written only by the analyze/ingest path.**
5. **`channel_accounts`** `(id, account_id, channel, handle, credential_ref, enabled, created_at)`.

## 3. AI workflows & how they're scheduled
Workflows = **LangGraph graphs** (the thinking), run as **jobs**:
- **research** — spawn marketing research for the campaign's ICP/topic (use cases,
  pain points, topic + competitor landscape) → `research` rows. Recalls generic
  research *methods/skills* from Dolt.
- **generate** — **populate the campaign funnel**: from voice + brief + research,
  lay out a content plan (topics × angles across **TOFU/MOFU/BOFU**) and draft posts
  to fill it. It is *not* N copies of one idea — it's coverage of the funnel. How
  many is **derived** from the plan / a per-layer target-depth on the campaign
  (operator-tunable, agent-proposed) — **never a hardcoded constant.**
- **refine/rank** — iterate (critique → revise, multi-pass; bumps `posts.revision`),
  score, promote best → `approved`, prune → `rejected`. **Generation is never a
  one-off — it is generate→refine, continuously topping up funnel coverage.**
- **analyze** — cached metrics → KPI per funnel-layer + channel → re-rank + distill
  *generic* learnings into the Dolt playbook.

**Autonomy is the core, not on-demand.** A campaign's `autonomy` field sets how far
it self-runs:
| `autonomy` | behavior |
|---|---|
| `autonomous` | the loop runs itself end-to-end; agent approval gates posting |
| `approve_gate` | self-runs research→generate→refine, then **waits for human approve** before post |
| `manual` | every stage is operator-triggered |

**Driver:** one real, self-firing **node-local timer** (k8s CronJob in beacon's
deploy) → an internal `/tick` that, for each `active` campaign, advances **whatever
stage has due work** (research stale → research; queue thin → generate/refine;
approved posts ready → post; metrics due → analyze). **Proven by Loki** (it fires
itself; never a manual curl). **On-demand triggers exist on every stage** as a
capability layered on top — kick generate now, force a re-research — but they are
not how the loop normally advances.
- **Temporal-native scheduling is deferred** until the operator worker is ready; the
  CronJob is the v0 substrate. No half-wired Temporal in the campaign path.

## 4. The spine (generate ≠ post — the safety invariant)
0. **define** → operator sets campaign voice + core topic + ICP + objective + autonomy.
1. **research** → research workflows fill `research` rows that ground the campaign.
2. **generate** → AI lays out the funnel plan (topics × angles × TOFU/MOFU/BOFU) and
   drafts `posts` (status `generated`) to fill it. Volume = funnel coverage, not a
   fixed count.
3. **refine/rank** → iterate (critique→revise, multi-pass), score, promote →
   `approved` (or `rejected`). Approval is agent-default; an `approve_gate` campaign
   **waits for a human** here.
4. **post** (cron `/tick`, **approved-only**) → pop highest-`score` `approved` post
   for an active campaign → publish to Moltbook → `posted`. **The publisher never
   generates, refines, or decides — it only ships already-approved content.**
5. **analyze** (cron) → ingest engagement → `post_metrics` → KPI → re-rank future
   candidates + distill generic learnings into Dolt.

The invariant that survives autonomy: **nothing reaches the public except an
`approved` row**, and the publisher is a dumb, auditable shipper. Autonomy changes
*who approves* (agent vs human gate), never *whether* approval happens.

## 5. The compounding loop
`posted → measured → analyzed → generic learnings into Dolt → recalled by the next
generate (customized per tenant) → better candidates.` Loops compound; that is the
entire point.

## 6. UI
- `/growth` (campaigns) → list; campaign detail → **posts grouped by lane** + an
  approve/reject control + per-layer KPI.
- **Kanban board (lanes = columns) is a vNext view.** v0 = a grouped list.

## 7. v0 depth vs deferred (discipline)
v0 builds the **whole spine thin**, not a few stages deep:
- research = **one pass** (ICP + topic + pain points); competitor-analysis as its own
  rich pipeline is later.
- generate = fill toward modest default `funnel_targets` (a few per layer; tunable,
  never a hardcoded N); refine = **1–2 passes**; rank = heuristic + brand-voice
  recall (not a learned model yet).
- autonomy = all three modes supported; coverage targets stay modest until ranking
  quality is proven.

**Deferred entirely:** RBAC / multi-user, channels beyond Moltbook (X, threads,
images/blob), DMs/comments/reposts, PostHog/BOFU conversion, auto-scaled volume,
Temporal-native heartbeat, RLS-Doltgres.

## 8. Decisions (resolved)
1. ✅ **Dolt purge:** campaign `metric:engagement` hypothesis moves out of Dolt into
   Postgres; `analyze` reads tenant KPI from Postgres only. Dolt holds **generic
   playbook/skills exclusively** (no tenant data; RLS-Dolt is someday). The
   independent-KPI verifier's data source = Postgres, not a Dolt hypothesis.
2. ✅ **No hardcoded volume:** generation fills toward per-campaign `funnel_targets`
   (coverage per funnel layer), operator-tunable / agent-proposed. There is no
   magic N; the funnel plan decides how much to draft.

## Build order (each its own small PR)
1. ✅ campaign CRUD + domain self-heal, no Temporal (PR #17, reduced).
2. **define**: extend `campaigns` with voice/core_topic/icp/objective/autonomy
   (+ rename `broadcasts`→`posts`, status lanes, `score`, `revision`; one migration).
3. **research**: `research` table + a 1-pass research workflow (ICP/topic/pain
   points), grounding the campaign brief.
4. **generate + refine**: N-draft generate grounded in voice+brief+research →
   iterate/rank → approve (agent; human gate when `approve_gate`). Lens shows lanes.
5. **post**: k8s CronJob `/tick` → publish approved-only → Moltbook (proven in Loki).
6. **analyze**: ingest + per-layer KPI → re-rank + Dolt playbook distill; **campaign
   KPI source = Postgres, not Dolt (§8.1).**
7. **autonomy**: `/tick` advances each `active` campaign through due stages per its
   `autonomy` mode.
