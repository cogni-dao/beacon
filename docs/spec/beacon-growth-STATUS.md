# beacon growth-loop — STATUS + plan (the single live reference)

> **This is the one "where are we / what next" doc.** Updated 2026-06-18, based on
> `main @ b521d28`. Supersedes the earlier STATUS draft (PR #33).
>
> **Honesty rule:** a piece is **PROVEN** only if it has been exercised end-to-end on a
> real deploy (candidate/preview) — *not* "CI green", *not* "typechecks", *not* "PR open".
> Everything else is 🔴 until shown running.
>
> Grounded in: [`../research/marketing-platforms-landscape.md`](../research/marketing-platforms-landscape.md)
> (the marketing-expert research — DEFINE/funnel/Hormozi/Welsh), the operator guide
> [`../guides/node-temporal.md`](../guides/node-temporal.md) (AI loop = one graph on cron,
> no node Temporal code), and design [`beacon-growth-loop-v0.md`](./beacon-growth-loop-v0.md).

## What the app actually DOES today (proven on a deploy)
A logged-in user can **create a campaign** (account-isolated, RLS) and — via a direct API
call — have the AI **generate ~6 funnel-classified post drafts**. That is the entire
proven surface. Nothing is published, scheduled, measured, or visible in the run
dashboard; "active" does nothing.

## Status matrix
Proven = runs on a deploy. BUILT but 🔴 = code exists, never shown working live.

| PIECE | BUILT | PROVEN E2E | REALITY |
|---|---|---|---|
| Create campaign (CRUD + RLS) | ✅ | 🟢 yes (candidate) | works |
| Generate = AI drafts (the function) | ✅ | 🟡 raw only (6 drafts via API, candidate) | works, but ungrounded + invisible + not via UI |
| DEFINE form (voice/topic/ICP/objective DNA) | ✅ PR #36 | 🔴 no | replaces the EDO-jargon form |
| Generate grounded in that DNA | ✅ #35/#36 | 🔴 no | the input now reaches the AI |
| Generate from a UI button | ✅ PR #34 | 🔴 no | the missing trigger |
| Research = AI findings | ✅ (#30, merged) | 🔴 no (never run on a deploy) | thin |
| Generate/Research as a **real graph** (executor → dashboard) | 🔴 | 🔴 | plain functions; invisible in the run dashboard |
| **Scheduled loop driver** (cron via GraphRunWorkflow) | 🔴 | 🔴 | "active" is a no-op; nothing self-runs |
| Dolt playbook (brand-voice grounding) | 🔴 (empty) | 🔴 | generate recalls nothing — seed drafted, not loaded |
| Analyze / per-layer KPI / learn | 🔴 | 🔴 | not started |
| EDO hypothesis (`target_rate` / `evaluate_at`) | ✅ | n/a | **wrong model** — one-shot verdict bolted on a loop; debt to unwind |

**Net proven: CRUD + a raw generate. Everything else is 🔴.**

## Open PRs (all 🔴 unproven; branch off the *old* main — rebase onto `b521d28`)
- **#36** — rebuild "New campaign" as the real DEFINE step (voice/topic/ICP/objective DNA; KPI mechanics defaulted server-side; no jargon/slug).
- **#35** — feed the campaign brief into generate + research (the dropped input).
- **#34** — Generate/Research buttons + honest "Activate".
- **#33** — earlier STATUS draft (this doc supersedes it).

## Pareto path → a Temporal + AI + research-driven content loop
The 80/20: **the AI generate/research logic already works.** The missing 20% that unlocks
everything is making it **one scheduled graph that runs through the executor.** Per
`node-temporal.md`: one LangGraph graph + a cron schedule on the *shared* worker —
**no node Temporal code.** Each step is proven on a deploy before the next.

1. **PROVE the manual core** (#34+#36 on preview): create campaign w/ DNA → click Generate
   → on-brief drafts. *Gate: needs a deploy.*
2. **One graph through the executor** (graphify Phase 1A): generate/research run via
   `GraphExecutorPort` → **visible in the run dashboard**. Prove on preview.
3. **Schedule it** (`GraphRunWorkflow` cron): the graph self-runs on a cadence for active
   campaigns. **This is the Temporal + loop** — and it *replaces* the broken
   `evaluate_at` one-shot with continuous re-evaluation. Prove via Loki + dashboard.
4. **Research-driven**: the scheduled graph runs research → generate, grounded in the
   campaign DNA + a seeded Dolt playbook.

**The gate on all of it:** getting code onto preview to prove each step.

## Explicitly cut (NOT on the path — avoid the drift)
Typed-outputs research model (`findings/exemplars/activity_runs` — over-built for now),
the graph purge, per-layer KPI rigor, autonomous "what to post next", off-policy eval,
DNA editability, multi-channel, video. **Unwind the EDO hypothesis** (`target_rate`/
`evaluate_at`) — step 3's cadence makes it moot; delete later.

## Debts / smells named
- **EDO-hypothesis-as-campaign is the wrong primitive** — `evaluate_at` resolves a campaign
  *once* at a deadline; a loop should re-evaluate continuously (step 3's cron).
- **Dolt brand-voice playbook is empty** — generate recalls nothing; seed drafted at
  `../research/_knowledge/dolt-playbook-seed.md`, not yet loaded (contribution API is
  session-cookie-gated in v0).
- **Graphs sprawl** — 13 inherited graphs; beacon needs `brain` (chat) + the growth graph.
  Verified purge list exists; not on the critical path.
</content>
