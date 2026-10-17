# beacon — the research & analytics loop (design)

> Companion to [`beacon-growth-loop-v0.md`](./beacon-growth-loop-v0.md). **Corrects spec
> §2.2:** `research` is NOT a table. Research is an *activity*; its outputs are typed.
> Grounded in [`../research/marketing-platforms-landscape.md`](../research/marketing-platforms-landscape.md).
> Status: draft — land into the SSOT when the research phase is built (it is not in #28,
> so it does not block shipping the foundation).

## 0. Thesis (syntropy, not entropy)

**Research and analytics are the same activity, run in opposite time directions.**
Research looks *forward* (what should we make?); analytics looks *backward* (what
worked?). Both consume signal, both produce **typed knowledge**, and both feed the same
store that `generate`/`refine` recall from. Modeled as one primitive, the loop
**compounds** (each cycle adds evidence and sharpens skills = syntropy). Modeled as two
disconnected features with a dumping-ground `research` blob table, it **decays** (rows
nobody recalls, correlation soup, a bloated playbook = entropy).

The entire design is one rule applied repeatedly: **every loop activity emits typed,
provenance-stamped knowledge that must keep earning its place or get pruned.**

## 1. The reframe: an activity emits typed outputs

A `research` (or `analyze`) run is an **activity** with inputs, a capability allowlist, a
budget, and provenance. It does not *own* a table — it *emits* into typed stores:

| Output type | Plane | What it is | Example |
|---|---|---|---|
| **Finding** | Postgres (tenant, RLS) | a falsifiable, scored *claim* about this tenant/market | "MOFU is thin for this ICP — 0 trust-building posts vs 12 TOFU" |
| **Reference / exemplar** | Postgres (tenant, RLS) | a collected *artifact*: external account/post/style + its observed performance + why-it-works | "@founderX's hook formula, 40k views, 'contrarian-then-proof'" |
| **Skill / guide** | **Doltgres (generic, app-wide)** | a distilled, reusable *method* — no tenant data | "B2B-SaaS hook formula: contrarian claim → proof → 1 CTA" |
| **Activity run** | Postgres (tenant) | provenance: who/what/when/cost produced the above | `run: research#7, web+listen, $0.12, 9 findings` |

The split is the existing foundational rule (§1 of the SSOT): **tenant-specific →
Postgres; reusable-for-any-tenant → Dolt.** Research findings are *this* campaign's;
the *method* that produced them is everyone's. Analytics obeys the same split: a tenant
KPI finding stays in Postgres; the generic "hook type X beats Y" rule distils to Dolt.

**Reuse, don't reinvent:** tenant `findings` mirror the proven Doltgres knowledge-atom
shape (`claim, confidence_pct, source_type, source_ref, status, citations`) — but
account-scoped in Postgres. The lifecycle (draft→candidate→established→deprecated) and
citation edges (`validates`/`invalidates`/`evidence_for`) are already designed in the
EDO model; tenant findings adopt them verbatim. Activity runs reuse the existing job/
graph-run + billing infra. Net-new surface is small.

## 2. Primitives (data model)

All tenant tables `account_id`-scoped, `pgPolicy("tenant_isolation")` + FORCE RLS.

1. **`activity_runs`** `(id, account_id, campaign_id, kind['research'|'analyze'|'generate'|'refine'|'post'], status, inputs(jsonb), capability_set(jsonb), budget_spent, policy_version, started_at, finished_at)` — the provenance spine. Every typed output carries `run_id`. This is what makes the loop *auditable* and lets us measure "did this activity help?".
2. **`findings`** `(id, account_id, campaign_id, run_id, kind['icp'|'pain_point'|'topic_demand'|'kpi'|'correlation'|'calibration'], claim, confidence_pct, source_type, source_ref, status['draft'|'validated'|'established'|'stale'], created_at)` — tenant claims, EDO-shaped, citable.
3. **`exemplars`** `(id, account_id, campaign_id, run_id, kind['account'|'post'|'style'], url, platform, observed_metrics(jsonb), why_it_works, created_at)` — the collected swipe-file: successful other accounts/posts/styles that ground generation and seed style-transfer.
4. **`finding_citations`** `(id, account_id, citing_id, cited_id, edge['validates'|'invalidates'|'evidence_for'|'supersedes'], created_at)` — analytics findings *validate or invalidate* research findings; metric snapshots are `evidence_for`. This is the truth-anchoring graph.
5. **Doltgres playbook (existing hub):** generic `skill`/`guide`/`rule` atoms distilled from tenant findings *across accounts*. No tenant data, ever. Promotion gated (§5).

`post_decisions` (propensity + context, from the landscape research) attaches to `posts`
and is the off-policy-eval substrate the analytics activity reads.

## 3. Capabilities (the typed tools each activity wields)

Activities are LangGraph graphs with a **capability allowlist** (the existing
`TOOL_CATALOG` + `configurable.toolIds` allowlist pattern — see `langgraph-patterns.md`).
Capabilities are the unit of permission.

| Activity | Allowed capabilities | Forbidden |
|---|---|---|
| **research** | `web_search`, `fetch_url`, `social_listen` (read public competitor/exemplar posts + their engagement), `trend_signal`, `llm_select`, `recall` (read playbook + tenant findings), `distill` (propose Dolt skill *candidate*) | cannot post; cannot read other tenants; cannot create `approved` rows |
| **analyze** | `read_metrics` (post_metrics), `kpi_resolve` (per-layer), `correlate` (features→engagement), `calibrate` (predicted vs realized), `recall`, `distill` | same forbids |
| **generate/refine** | `recall` (findings + exemplars + playbook skills), `llm_generate`, `score` | cannot research the open web (that's research's job); cannot publish |

Capabilities are **composable and metered**: each is a typed tool with its own cost +
rate budget, so an autonomous research run can't silently burn the campaign budget.

## 4. Permissions

Five gates, layered:

1. **Tenant isolation (RLS + FORCE):** findings/exemplars/runs are `account_id`-scoped; the Dolt playbook is app-wide and holds *no* tenant data. Non-negotiable.
2. **Capability allowlist:** an activity can only call tools in its set (§3). Research can read the public web; it can never publish or touch another tenant.
3. **Budget gate:** research/analytics are expensive (deep web, LLM). Each campaign carries a per-cycle budget; `activity_runs.budget_spent` enforces it. Autonomy never means unbounded spend.
4. **Write boundary:** research/analytics may write tenant findings/exemplars and *propose* Dolt skills as `candidate`. They may **not** mint `approved` posts — only the `refine→approve` path can. The safety invariant (nothing public except approved) is untouched.
5. **Promotion gate:** a generic skill enters the playbook as `candidate`; promotion to `established` requires cross-campaign/off-policy evidence (§5) — and, under `approve_gate` autonomy, a human ok. This is the guard against the playbook learning the wrong lesson from one lucky tenant.

## 5. KPIs, measurement & refinement (the anti-entropy engine)

Measure at **three levels** — a single global engagement number measures nothing useful:

**Level 1 — Output KPI (per post):** per-funnel-layer engagement (TOFU=reach,
MOFU=trust, BOFU=conversion). Raw events appended to `post_metrics`, aggregated on read.

**Level 2 — Activity KPI (does the loop help?):** the lift attributable to an activity.
Posts grounded in fresh `findings`/`exemplars` vs not; posts that applied a playbook
`skill` vs not. If research/analytics doesn't move Level-1 outcomes, it is cost without
syntropy — measure it explicitly, don't assume it.

**Level 3 — Loop calibration (the truth anchor):** `refine`'s predicted score vs the
post's *realized* KPI, per finding/skill. The gap is the master signal:
- gap shrinking → the playbook models reality → promote skills, tighten.
- gap widening / predictions self-consistent but reality-divergent → the **self-reinforcing-judge** trap (the loop likes its own taste). Demote, re-research, widen exploration.

**Refinement lifecycle (knowledge must earn its place):**
```
finding/skill:  proposed ──evidence──▶ validated ──cross-cycle──▶ established
                    │                      │                          │
                    └────── no/contra ─────┴─── decays if stale ──────┘──▶ pruned/deprecated
```
- A `finding` is `validated` only when a later analytics run cites it `evidence_for` (or `invalidates` it).
- A skill promotes to the Dolt playbook only when **off-policy evaluation** over the `post_decisions` log shows the candidate strategy beats the incumbent on logged history (Open Bandit Pipeline IPW/Doubly-Robust) — not on vibes.
- Anything that stops predicting engagement **decays and is pruned**. The playbook stays small and high-signal; recall stays sharp. *Pruning is the core anti-entropy act.*

## 6. Syntropy vs entropy — the failure modes this design forecloses

| Entropy failure | Anti-entropy mechanism |
|---|---|
| `research` dumping-ground table nobody recalls | typed outputs (findings/exemplars/skills) + provenance + mandatory recall by generate/refine |
| self-reinforcing judge (loop likes its own taste) | Level-3 calibration KPI; promotion gated on realized KPI, not predicted |
| playbook bloat → noisy recall | promotion gate + decay/prune lifecycle; playbook stays small |
| correlation soup (findings never tested) | citation graph; a finding isn't `established` until evidence validates it |
| "improvement" that's just luck | off-policy eval over `post_decisions` before any skill promotion |
| tenant data polluting the shared playbook | the Postgres/Dolt split (§1) — generic skills only, no tenant rows in Dolt |

## 7. What to build (guidance for the research phase)

Sequenced to compound, reusing existing infra; each step demoable:

1. **`activity_runs` + `findings` + `exemplars` + `finding_citations`** (one migration, RLS-first via `schema-update`). Replaces the SSOT's `research` table. Findings reuse the EDO atom shape.
2. **`research` activity (LangGraph graph)** with the §3 capability allowlist: discover→filter→select→deep-read → emit findings + exemplars; `distill` proposes Dolt skill candidates. Grounds the campaign brief in the UI.
3. **`analyze` activity** upgraded to per-layer KPI + `correlate`/`calibrate` → emits `kpi`/`correlation`/`calibration` findings + `evidence_for`/`invalidates` edges back onto research findings.
4. **Recall wiring:** `generate`/`refine` read findings + exemplars + playbook skills as grounding (the loop closes).
5. **Promotion + OPE gate** for Dolt skill candidates (this is LEARN tier-2, the moat — sequence last, after evergreen-recycle, per the landscape research).

Reuses: EDO knowledge model (atom shape + citations + status lifecycle), the job/graph-
run + billing infra, `TOOL_CATALOG` allowlist, and the existing Postgres/Dolt split. The
net-new is four tenant tables + two activity graphs — not a new subsystem.
</content>
