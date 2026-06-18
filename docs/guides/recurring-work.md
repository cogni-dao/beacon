# Recurring work — scheduling beacon's growth loop

beacon's growth loop (GENERATE → POST → MEASURE → SCORE) becomes self-running by
**scheduling** its ops routes through the operator. No Temporal code, no cron in
beacon, no boot hook — the operator runs each route on cadence **under beacon's own
identity** via `NodeTaskWorkflow`. Proven live on candidate-a (operator story.5008).

> **One path:** `POST /api/v1/schedules` (the `/schedules` page). `route` →
> `NodeTaskWorkflow` (HTTP dispatch); `graphId` → `GraphRunWorkflow`. Same converged
> substrate — there is no second mechanism.

## beacon already has the routes

| stage | route | schedule it |
| --- | --- | --- |
| MEASURE (ingest) | `POST /api/internal/ops/growth/metrics-ingest` | `*/15 * * * *` |
| SCORE (resolve) | `POST /api/internal/ops/growth/resolve` | `*/30 * * * *` |

GENERATE→POST is already a Temporal Schedule (campaigns). These two close the loop.

## Integrate (two checks, then schedule)

**1. Make each ops route dispatch-ready** (likely already true — verify):
- accepts `Authorization: Bearer ${SCHEDULER_API_TOKEN}` (the operator dispatches with it);
- is **idempotent** — dedup on the `Idempotency-Key` header
  (`<nodeId>/<scheduleId>/<scheduledFor>`); delivery is at-least-once, so the same
  key must be a no-op;
- returns `200` and logs an event (read it back in Loki to confirm it fired).

**2. Create the schedules** (`POST /api/v1/schedules` or the `/schedules` UI):

```jsonc
{ "route": "/api/internal/ops/growth/metrics-ingest", "input": {}, "cron": "*/15 * * * *", "timezone": "UTC" }
{ "route": "/api/internal/ops/growth/resolve",        "input": {}, "cron": "*/30 * * * *", "timezone": "UTC" }
```

That's the whole loop self-running — Draft → Posted → Measuring → Scored on its own.

## What you own vs the operator

| concern | owner |
| --- | --- |
| schedule lifecycle, Temporal, the grant, overlap/catchup | operator |
| ingest/resolve logic + idempotency on `Idempotency-Key` | beacon (your routes) |

`route` is node-relative only (`/`, no scheme/`//`/`..` — SSRF guard). For the full
contract + the candidate-a proof, see the operator `infrastructure` knowledge hub:
*"How a node builds its first scheduled feature"* and *"NodeTask schedule dispatch proven live on candidate-a"*.
