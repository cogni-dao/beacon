// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-generate/workflow`
 * Purpose: The GENERATE activity of the beacon growth loop — a thin, pure workflow
 *   that turns a campaign's strategy + its research `findings` into a set of draft
 *   posts that POPULATE THE FUNNEL (spread across TOFU/MOFU/BOFU × topics/angles).
 *   GENERATE_IS_AN_ACTIVITY: this is a workflow, not a table; the route persists its
 *   output rows account-scoped as `posts` (status 'generated') — see the generate route.
 * Scope: Pure orchestration. Derive per-layer volume from `funnelTargets` → one LLM
 *   call per layer (handed strategy + findings + recalled playbook) → parse to typed
 *   draft posts. Does NOT touch the DB, env, HTTP, or Doltgres — all I/O is injected
 *   (mirrors the growth-research workflow's pure-function shape).
 * Invariants:
 *   - PURE_ORCHESTRATION: no side effects beyond the injected callables; no env reads.
 *   - INJECTED_IO: `complete` (LLM) and optional `recallPlaybook` (Dolt) are injected,
 *     so unit tests run with fakes and the package stays decoupled from app ports.
 *   - VOLUME_FROM_FUNNEL_TARGETS: per-layer draft count is DERIVED from the campaign's
 *     `funnelTargets` — NEVER a hardcoded N. Unset/invalid → a modest default per layer.
 *   - POPULATE_THE_FUNNEL: the run spreads posts across layers × distinct topics/angles
 *     — it is funnel coverage, NOT N copies of one idea.
 *   - FAIL_OPEN_RECALL: a recall failure degrades to no-playbook, never throws.
 *   - PACKAGES_NO_SRC_IMPORTS: no imports from src/**
 * Side-effects: none (all I/O injected)
 * Links: docs/spec/beacon-growth-loop-v0.md §0/§3/§4/§7, ./prompts.ts,
 *         packages/langgraph-graphs/src/graphs/growth-research/workflow.ts
 * @public
 */

import type { CampaignStrategy, CompleteFn, RecallPlaybookFn } from "../growth-research/workflow";
import {
  FUNNEL_LAYER_GUIDANCE,
  FUNNEL_LAYERS,
  type FunnelLayer,
  GENERATE_PROMPT,
} from "./prompts";

export type { FunnelLayer } from "./prompts";
export { FUNNEL_LAYERS } from "./prompts";

/** Per-funnel-layer desired draft count (the tunable that drives volume). */
export type FunnelTargets = Partial<Record<FunnelLayer, number>>;

/** One synthesized research finding fed in to ground generation. */
export interface GenerateFinding {
  kind: string;
  content: string;
}

/** One draft post produced by the generate activity (the route stamps the rest). */
export interface DraftPost {
  funnelLayer: FunnelLayer;
  topic: string;
  angle: string;
  text: string;
  /** Channel — v0 single channel. */
  channel: "moltbook";
  /** Content kind — text-only in v0. */
  kind: "text";
}

export interface RunGrowthGenerateInput {
  strategy: CampaignStrategy;
  /** The campaign's research findings (read from Postgres by the route). */
  findings?: readonly GenerateFinding[];
  /**
   * Per-layer coverage target (from `campaigns.funnel_targets`). DERIVES volume —
   * a layer's count = its target; unset/invalid layers fall back to `defaultPerLayer`.
   */
  funnelTargets?: FunnelTargets | null;
  complete: CompleteFn;
  recallPlaybook?: RecallPlaybookFn;
  /** Default per-layer draft count when a layer has no valid target (modest). */
  defaultPerLayer?: number;
  /** Defensive hard cap per layer so a runaway target can't flood the queue. */
  maxPerLayer?: number;
}

/** Modest default coverage when `funnelTargets` is unset (spec §7: "a few per layer"). */
const DEFAULT_PER_LAYER = 2;
/** Defensive ceiling on per-layer volume (a runaway target must not flood the queue). */
const MAX_PER_LAYER = 10;

/**
 * Resolve a layer's draft count from the campaign's `funnelTargets`.
 * VOLUME_FROM_FUNNEL_TARGETS: target wins; a non-positive/invalid/missing target
 * falls back to the modest default. The result is clamped to [0, maxPerLayer].
 */
export function resolveLayerCount(
  layer: FunnelLayer,
  funnelTargets: FunnelTargets | null | undefined,
  defaultPerLayer: number,
  maxPerLayer: number
): number {
  const raw = funnelTargets?.[layer];
  const count =
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0
      ? Math.floor(raw)
      : defaultPerLayer;
  return Math.max(0, Math.min(count, maxPerLayer));
}

/** Render the campaign strategy as a compact, labelled brief for the model. */
function renderStrategy(s: CampaignStrategy): string {
  return [
    `brief (the campaign description — ground every post in this): ${s.brief?.trim() || "(none given)"}`,
    `core_topic: ${s.coreTopic?.trim() || "(derive from the brief)"}`,
    `voice: ${s.voice?.trim() || "(derive from the brief)"}`,
    `icp: ${s.icp?.trim() || "(derive from the brief)"}`,
    `objective: ${s.objective?.trim() || "(derive from the brief)"}`,
  ].join("\n");
}

/** Render the campaign findings as a compact list for the model. */
function renderFindings(findings: readonly GenerateFinding[]): string {
  if (findings.length === 0) return "(no research findings yet)";
  return findings
    .filter((f) => typeof f.content === "string" && f.content.trim().length > 0)
    .map((f) => `- [${f.kind}] ${f.content.trim()}`)
    .join("\n");
}

/** Best-effort recall — never throws; an empty/failed hub yields no playbook. */
async function safeRecall(
  recall: RecallPlaybookFn | undefined,
  query: string
): Promise<string[]> {
  if (!recall) return [];
  try {
    const notes = await recall(query);
    return notes.filter(
      (n): n is string => typeof n === "string" && n.trim().length > 0
    );
  } catch {
    return [];
  }
}

/**
 * Parse the model's JSON array of `{topic, angle, text}` for one layer into typed
 * draft posts. Tolerant: ignores non-JSON, drops rows missing `text`, trims fields,
 * defaults a missing topic/angle. Never throws. Caps at `limit` (the layer's count).
 */
export function parseDraftPosts(
  raw: string,
  layer: FunnelLayer,
  limit: number
): DraftPost[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: DraftPost[] = [];
  for (const item of parsed) {
    if (out.length >= limit) break;
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const text = rec.text;
    if (typeof text !== "string" || text.trim().length === 0) continue;
    const topic = typeof rec.topic === "string" ? rec.topic.trim() : "";
    const angle = typeof rec.angle === "string" ? rec.angle.trim() : "";
    out.push({
      funnelLayer: layer,
      topic: (topic || "general").toLowerCase().slice(0, 80),
      angle: angle || text.trim().slice(0, 120),
      text: text.trim(),
      channel: "moltbook",
      kind: "text",
    });
  }
  return out;
}

/**
 * Run the GENERATE activity for a campaign: populate the funnel.
 *
 * 1. Recall generic brand-voice/playbook from the knowledge hub (injected, fail-open).
 * 2. For EACH funnel layer, derive its draft count from `funnelTargets` (no hardcoded N).
 * 3. One LLM call per (non-empty) layer → parse to `count` DISTINCT draft posts.
 *
 * Returns the flattened draft posts across layers; persistence as `posts`
 * (status 'generated', account-scoped) is the caller's job. Pure aside from the
 * injected callables.
 */
export async function runGrowthGenerate(
  input: RunGrowthGenerateInput
): Promise<DraftPost[]> {
  const {
    strategy,
    findings = [],
    funnelTargets,
    complete,
    recallPlaybook,
    defaultPerLayer = DEFAULT_PER_LAYER,
    maxPerLayer = MAX_PER_LAYER,
  } = input;

  const recallQuery = [strategy.coreTopic, strategy.icp, "high-engagement post hooks angles"]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(" ");
  const playbook = await safeRecall(
    recallPlaybook,
    recallQuery || "high-engagement post hooks angles"
  );
  const playbookBlock =
    playbook.length > 0
      ? `\n\nRecalled generic playbook (apply customized, do not copy):\n- ${playbook.join("\n- ")}`
      : "";

  const strategyBlock = renderStrategy(strategy);
  const findingsBlock = renderFindings(findings);

  const drafts: DraftPost[] = [];
  // POPULATE_THE_FUNNEL: one pass per layer, count DERIVED from funnelTargets.
  for (const layer of FUNNEL_LAYERS) {
    const count = resolveLayerCount(
      layer,
      funnelTargets,
      defaultPerLayer,
      maxPerLayer
    );
    if (count <= 0) continue;

    const system = GENERATE_PROMPT.replace(/\{count\}/g, String(count));
    const user = [
      `Campaign strategy:\n${strategyBlock}`,
      `Funnel layer to populate:\n${FUNNEL_LAYER_GUIDANCE[layer]}`,
      `Research findings:\n${findingsBlock}${playbookBlock}`,
    ].join("\n\n");

    const text = await complete({ system, user });
    drafts.push(...parseDraftPosts(text, layer, count));
  }

  return drafts;
}
