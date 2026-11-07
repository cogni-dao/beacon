# goals

Beacon-owned Goals + KPIs presentation. The measurement engine and wire contract (`GoalsProgressSchema`, `KpiAssessmentSchema`, `MetricHistorySchema`, `MetricDisplaySchema`) live in the published `@cogni-dao/metrics/contracts`. This feature owns the board (`components/GoalsBoard`), the open KPI chart (`components/KpiChart`) and per-type card numbers (`lib/display`).

## UI invariants

- **Read only.** The UI never computes, estimates or re-derives a KPI. Status comes from the read model's `assessKpi` result. The refresh worker computes readings.
- **Display type comes from `kpi.metric.display`.** It is never guessed from units:
  - progress: a bar toward the target.
  - volume: a sparkline plus the change since its first bucket.
  - slo: availability bars plus the error budget. Values are truncated, never rounded up to 100%.
- **Unknown is not zero.** A missing reading shows as "—" with `aria-label="No reading"`. Gaps stay gaps (`connectNulls={false}`). Stale readings are never shown as current.
- **Status is never color alone.** Every status carries a symbol and a word (`STATUS_META`).
- **Polling is quiet.** `GoalsBoard` is reusable and has no Knowledge-route imports. Knowledge mounts it only on `?mode=goals`, and its 30s poll runs only while it is mounted. A failed poll keeps the data. Only `STALE_AFTER_FAILURES` consecutive failures mark the board "Stale".
- **Recharts children must be its own element types.** Pass arrays, not Fragments. Every chart takes a `useChartId` id. No animation.
- **No outward imports.** This feature never imports bootstrap, app or adapter code.
