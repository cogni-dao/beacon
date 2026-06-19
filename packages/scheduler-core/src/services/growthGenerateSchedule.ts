// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-core/services/growthGenerateSchedule`
 * Purpose: SCAFFOLD the cron registration for the growth-generate catalog graph — the
 *   GENERATE activity of the beacon growth loop, run autonomously on a schedule by the
 *   SHARED worker via GraphRunWorkflow (graphId `langgraph:growth-generate`). Per
 *   docs/guides/node-temporal.md: "AI work is a graph, run on cron by the shared worker"
 *   — this builds the typed `CreateScheduleParams` that registers that cron. Pure: it
 *   produces the registration SHAPE; the live `scheduleControl.createSchedule(...)` call
 *   (and the grant + system tenant + Temporal substrate it needs) is the app/operator's
 *   job and is NOT exercised here.
 * Scope: Pure builder — depends only on `CreateScheduleParams` and a `JsonValue` input.
 *   No adapters, no Temporal client, no I/O. Mirrors `syncGovernanceSchedules`' params
 *   shape so the live wiring is a one-liner: `scheduleControl.createSchedule(params)`.
 * Invariants:
 *   - GRAPH_RUN_WORKFLOW: workflowType is "GraphRunWorkflow" (the shared-worker AI path).
 *   - STABLE_GRAPH_ID: graphId is EXACTLY "langgraph:growth-generate" — the catalog seam.
 *   - PURE_BUILDER: no I/O; the caller owns grant creation + the createSchedule call.
 *   - OVERLAP_SKIP_DEFAULT: scheduled growth-generate uses overlap=SKIP (no pile-up).
 *   - AT_MOST_ONCE_RISK: dispatch is maximumAttempts:1 — a dropped run is simply skipped
 *     until the next tick; the GENERATE activity APPENDS drafts (IDEMPOTENCY_APPEND_V0),
 *     so a re-run would duplicate, not corrupt. See report / generate route invariants.
 *   - SYSTEM_OPS_ONLY: registration runs at deploy/ops time, never as a tenant API.
 *   - FORBIDDEN: `@/`, `src/`, drizzle-orm, any I/O (scheduler-core package rule).
 * Side-effects: none
 * Links: ../ports/schedule-control.port.ts, ./syncGovernanceSchedules.ts,
 *   docs/guides/node-temporal.md, packages/langgraph-graphs/src/graphs/growth-generate/graph.ts
 * @public
 */

import type { JsonValue } from "type-fest";

import type { CreateScheduleParams } from "../ports/schedule-control.port";

/**
 * Fully-qualified graphId of the growth-generate catalog graph.
 * STABLE_GRAPH_ID: kept in lockstep with `LANGGRAPH_GRAPH_IDS["growth-generate"]`
 * (`@cogni/langgraph-graphs`). scheduler-core must not import the graphs package
 * (that would couple the scheduler to LangChain), so the id is mirrored here as a
 * literal; the registration-shape test pins it.
 */
export const GROWTH_GENERATE_GRAPH_ID = "langgraph:growth-generate" as const;

/** Temporal schedule ID for the growth-generate cron. Stable, prefix-discoverable. */
export const GROWTH_GENERATE_SCHEDULE_ID = "growth-generate" as const;

/** Default cadence: every 6 hours (modest; tune per campaign maturity). */
export const GROWTH_GENERATE_DEFAULT_CRON = "0 */6 * * *" as const;

/** Default IANA timezone for the schedule. */
export const GROWTH_GENERATE_DEFAULT_TIMEZONE = "UTC" as const;

/** Inputs the caller must supply to build the registration (the substrate-bound bits). */
export interface BuildGrowthGenerateScheduleParamsInput {
  /** Originating node ID from repo-spec (routes execution into this node). */
  readonly nodeId: string;
  /** User ID that owns the schedule (the system/ops principal). */
  readonly ownerUserId: string;
  /** Execution grant ID authorizing the graph run (created by the caller). */
  readonly executionGrantId: string;
  /**
   * The growth-generate graph input — the `configurable.growthGenerate` payload
   * (campaign strategy + findings + funnel targets). Already JSON-serializable; the
   * graph reads it off `configurable`. See the growth-generate graph/state.
   */
  readonly input: JsonValue;
  /** Override the default schedule ID (e.g. to scope per-campaign). */
  readonly scheduleId?: string;
  /** DB schedule UUID, when the schedule has a `schedules` row. */
  readonly dbScheduleId?: string | null;
  /** Override the default cron (5-field). */
  readonly cron?: string;
  /** Override the default IANA timezone. */
  readonly timezone?: string;
}

/**
 * Build the typed `CreateScheduleParams` that registers the growth-generate cron.
 *
 * PURE_BUILDER: this returns the registration shape only. To go live, the caller
 * (app deploy/ops, with the Temporal substrate) does:
 *   `await scheduleControl.createSchedule(buildGrowthGenerateScheduleParams(input))`
 * after ensuring an execution grant exists (mirrors `syncGovernanceSchedules`).
 *
 * @param input - The substrate-bound bits (node, owner, grant, graph input) + overrides.
 * @returns A `CreateScheduleParams` targeting GraphRunWorkflow + `langgraph:growth-generate`.
 */
export function buildGrowthGenerateScheduleParams(
  input: BuildGrowthGenerateScheduleParamsInput
): CreateScheduleParams {
  return {
    scheduleId: input.scheduleId ?? GROWTH_GENERATE_SCHEDULE_ID,
    nodeId: input.nodeId,
    dbScheduleId: input.dbScheduleId ?? null,
    ownerUserId: input.ownerUserId,
    cron: input.cron ?? GROWTH_GENERATE_DEFAULT_CRON,
    timezone: input.timezone ?? GROWTH_GENERATE_DEFAULT_TIMEZONE,
    graphId: GROWTH_GENERATE_GRAPH_ID,
    executionGrantId: input.executionGrantId,
    input: input.input,
    // SKIP: never let a slow generate run pile up on the next tick.
    overlapPolicy: "skip",
    // No backfill — a missed tick is simply skipped (AT_MOST_ONCE_RISK note above).
    catchupWindowMs: 0,
    // GRAPH_RUN_WORKFLOW: the shared-worker AI path (default, made explicit here).
    workflowType: "GraphRunWorkflow",
  };
}
