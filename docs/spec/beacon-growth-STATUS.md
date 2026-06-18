# beacon growth-loop — STATUS (live progress tracker)

> The single "where are we" reference. Design/contract = `beacon-growth-loop-v0.md`.
> Research/analytics design = `beacon-research-analytics-loop.md` (dev2; **supersedes
> the thin research model currently in main — see Reconcile below**).
> Honesty rule: a stage is **PROVEN** only if exercised end-to-end on the deploy, not
> "CI green." Last updated: 2026-06-18.

## What the app DOES today (proven)
A multi-tenant web app where a logged-in user can:
1. **Create a campaign** (title, brief, target rate, deadline) — account-isolated (RLS). ✅ proven
2. **Generate AI post drafts for it** — one click produces ~6 posts spread across a
   TOFU/MOFU/BOFU funnel, shown on `/growth`. ✅ proven live on candidate (6 posts).

That is the whole working surface. **Nothing is published, measured, ranked, or
auto-run.** Posts sit as `generated` drafts. There is no live audience output yet.

## What v0 IS (the target kernel)
An autonomous-by-default loop per campaign:
**DEFINE → RESEARCH → GENERATE → REVIEW/REFINE → APPROVE → POST → MEASURE → ANALYZE → LEARN ↺**
Moltbook-first, single account per tenant. A campaign is *strategy* (voice/topic/ICP);
beacon researches, drafts to fill the funnel, refines, publishes approved-only, measures
per-funnel-layer, and compounds generic learnings into the Dolt playbook.

## Roadmap & progress
Legend: 🟢 proven e2e · 🟡 merged but NOT proven e2e (or design-divergent) · 🔵 in PR (open, unmerged) · ⚪ not started

| # | Stage | State | Evidence / gap |
|---|---|---|---|
| 1 | DEFINE — campaign CRUD + posts/strategy schema + RLS | 🟢 | create/list/toggle/delete proven on candidate; RLS DB-tested |
| 2 | RESEARCH — findings + workflow | 🟡 | merged (#30) + unit/RLS-tested, **but never triggered on the deploy**, and **thin vs dev2's design** (see Reconcile) |
| 3 | GENERATE — fill funnel with AI drafts | 🟢 | proven on candidate (#31): 6 posts across TOFU/MOFU/BOFU |
| 4 | APPROVE + PUBLISH (fake Moltbook) | 🔵/⚪ | being built as an OPEN PR; unmerged, unproven |
| 5 | MEASURE / ANALYZE — per-layer KPI | ⚪ | not started |
| 6 | EVERGREEN-RECYCLE | ⚪ | not started |
| 7 | HEARTBEAT — self-run (no manual triggers) | ⚪ | not started; everything today is on-demand |
| 8 | AUTONOMOUS PLANNING | ⚪ | sequenced LAST by design |

## Open reconcile / debts
- **Research model is wrong in main.** #30 shipped a single thin `findings` table.
  dev2's `beacon-research-analytics-loop.md` corrects it: typed outputs
  (`findings`/`exemplars`/`activity_runs`/`finding_citations`), capability allowlists,
  5 permission gates, knowledge lifecycle (research+analytics are one primitive).
  **Next research work must adopt that design, not extend the thin one.**
- **Process:** #28/#30/#31 were merged on CI + agent-validation, NOT human review.
  Going forward: PRs stay OPEN for review.
- **Candidate-a** is currently the X-account-linking dev's; no flighting from this lane
  until it frees up.

## Merged to main (history)
#28 foundation (CRUD+self-heal+define) · #30 research (thin, to reconcile) ·
#31 generate (proven). Earlier: #14 tenancy/RLS, #13 campaigns, #1 style-kit.
