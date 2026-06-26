// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-generate/workflow`
 * Purpose: The GENERATE activity of the beacon growth loop — a thin, pure workflow
 *   that turns a campaign's strategy + its research `findings` into a set of draft
 *   posts that POPULATE THE FUNNEL (spread across TOFU/MOFU/BOFU × topics/angles).
 *   Generation is a TWO-PASS quality loop per layer: a DRAFT pass writes N posts, then
 *   a CRITIQUE→REVISE refine pass rewrites them on a named rubric (hook strength,
 *   single-CTA, on-voice, value-equation, no-bait). This is the quality loop the design
 *   always called for — quality comes from the playbook-grounded prompt + refine, NOT a
 *   bigger model. GENERATE_IS_AN_ACTIVITY: this is a workflow, not a table; the route
 *   persists its output rows account-scoped as `posts` (status 'generated').
 * Scope: Pure orchestration. Derive per-layer volume from `funnelTargets` → a DRAFT
 *   `complete()` then ONE REFINE `complete()` per layer (each handed strategy + findings
 *   + recalled playbook) → parse to typed draft posts. Does NOT touch the DB, env, HTTP,
 *   or Doltgres — all I/O is injected (mirrors the growth-research workflow's shape).
 * Invariants:
 *   - PURE_ORCHESTRATION: no side effects beyond the injected callables; no env reads.
 *   - INJECTED_IO: `complete` (LLM) and optional `recallPlaybook` (Dolt) are injected,
 *     so unit tests run with fakes and the package stays decoupled from app ports.
 *     EVERY LLM call (draft AND refine) routes through the SAME injected `complete` —
 *     the route backs it with the gated billing facade (BILLABLE_AI_THROUGH_EXECUTOR);
 *     this workflow NEVER touches a raw LlmService.
 *   - VOLUME_FROM_FUNNEL_TARGETS: per-layer draft count is DERIVED from the campaign's
 *     `funnelTargets` — NEVER a hardcoded N. Unset/invalid → a modest default per layer.
 *   - POPULATE_THE_FUNNEL: the run spreads posts across layers × distinct topics/angles
 *     — it is funnel coverage, NOT N copies of one idea.
 *   - CRITIQUE_THEN_REVISE: after the draft pass, ONE bounded refine pass per layer
 *     critiques+rewrites the batch on a named rubric; a refine failure FAILS OPEN to the
 *     draft batch (never throws, never loops).
 *   - FAIL_OPEN_RECALL: a recall failure degrades to no-playbook, never throws.
 *   - PACKAGES_NO_SRC_IMPORTS: no imports from src/**
 * Side-effects: none (all I/O injected)
 * Links: docs/spec/beacon-growth-loop-v0.md §0/§3/§4/§7, ./prompts.ts,
 *         packages/langgraph-graphs/src/graphs/growth-research/workflow.ts
 * @public
 */

import {
  type CampaignStrategy,
  type CompleteFn,
  extractJsonArray,
  type RecallPlaybookFn,
} from "../growth-research/workflow";
import {
  FUNNEL_LAYER_CTA,
  FUNNEL_LAYER_GUIDANCE,
  FUNNEL_LAYERS,
  type FunnelLayer,
  GENERATE_PROMPT,
  REFINE_PROMPT,
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
  /**
   * How many critique→revise passes this draft survived. 0 = raw draft pass only;
   * 1 = the refine pass rewrote it on the named rubric. CRITIQUE_THEN_REVISE bumps
   * this so the queue (and the route's persisted `revision`) reflects the quality loop.
   */
  revision: number;
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
  /**
   * Run the CRITIQUE→REVISE refine pass after the draft pass (default true). One
   * bounded extra `complete()` per layer. Set false only for tests/diagnostics that
   * want the raw draft batch — production keeps the quality loop on.
   */
  refine?: boolean;
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
 *
 * `revision` stamps the quality-loop generation each row came from (0 = draft pass,
 * 1 = after the critique→revise refine pass) — both the draft and refine passes emit
 * the SAME `{topic, angle, text}` shape, so the parser is shared and robust to either.
 */
export function parseDraftPosts(
  raw: string,
  layer: FunnelLayer,
  limit: number,
  revision = 0
): DraftPost[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonArray(raw));
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
      revision,
    });
  }
  return out;
}

/**
 * CRITIQUE→REVISE refine pass for one layer's draft batch. Hands the SAME grounding
 * (campaign DNA + playbook + the layer's single allowed CTA) plus the freshly drafted
 * posts to the injected `complete`, asks it to critique each on the named rubric and
 * REWRITE it, then re-parses the improved batch (revision = 1).
 *
 * Bounded + fail-open: exactly ONE extra `complete()` call (never a loop). If the
 * refine call throws OR returns a batch that doesn't cover all the drafts (parse
 * dropout / shape drift), the original draft batch is kept — refine never regresses
 * coverage or throws. Returns the SAME number of posts as it was given.
 */
async function refineDraftBatch(
  complete: CompleteFn,
  layer: FunnelLayer,
  drafts: DraftPost[],
  refineSystem: string,
  grounding: string
): Promise<DraftPost[]> {
  if (drafts.length === 0) return drafts;

  const draftsForModel = JSON.stringify(
    drafts.map((d) => ({ topic: d.topic, angle: d.angle, text: d.text }))
  );
  const user = [grounding, `Draft posts to critique and rewrite:\n${draftsForModel}`].join(
    "\n\n"
  );

  let revisedRaw: string;
  try {
    revisedRaw = await complete({ system: refineSystem, user });
  } catch {
    return drafts; // FAIL_OPEN: a refine error keeps the draft batch.
  }

  const revised = parseDraftPosts(revisedRaw, layer, drafts.length, 1);
  // Coverage guard: the refine pass must return one improved post per input draft.
  // A short/garbled batch (model dropped or merged rows) is NOT an improvement —
  // keep the full draft batch rather than silently shrinking the funnel.
  return revised.length === drafts.length ? revised : drafts;
}

/** One existing draft to refine (the human Refine action's input). */
export interface SingleDraftToRefine {
  funnelLayer: FunnelLayer;
  topic: string;
  angle: string;
  text: string;
}

export interface RefineSingleDraftInput {
  strategy: CampaignStrategy;
  /** The single existing draft the human chose to refine. */
  draft: SingleDraftToRefine;
  /** The campaign's research findings (read from Postgres by the route). */
  findings?: readonly GenerateFinding[];
  /**
   * Optional human feedback note steering THIS revision (e.g. "make the hook
   * sharper, drop the jargon"). The HUMAN_FEEDBACK_IS_LAW — it is handed to the
   * editor as a directive above the rubric. Empty/absent → pure rubric refine.
   */
  feedback?: string;
  complete: CompleteFn;
  recallPlaybook?: RecallPlaybookFn;
}

/**
 * REFINE one existing draft into a NEW revision — the human Refine action.
 *
 * Reuses the SAME `REFINE_PROMPT` + grounding (campaign DNA + playbook + the layer's
 * single allowed CTA) + `parseDraftPosts` parser as the generate-time refine pass, so
 * one draft is critiqued/rewritten on the exact rubric the writer was held to. When a
 * human `feedback` note is given it is injected as a TOP-PRIORITY directive (above the
 * rubric) so the operator's steer wins.
 *
 * Returns the rewritten draft, or `null` if the model produced no usable post (the
 * route then keeps the original — refine never destroys the draft). Exactly ONE
 * `complete()` call (the SAME injected, gated facade the route backs `runGrowthGenerate`
 * with — BILLABLE_AI_THROUGH_EXECUTOR holds for the Refine action too). Caller stamps
 * the revision number; the returned `revision` field is advisory (1).
 */
export async function refineSingleDraft(
  input: RefineSingleDraftInput
): Promise<DraftPost | null> {
  const { strategy, draft, findings = [], feedback, complete, recallPlaybook } =
    input;
  const layer = draft.funnelLayer;

  const recallQuery = [strategy.coreTopic, strategy.icp, draft.topic, "high-engagement post hooks angles"]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(" ");
  const playbook = await safeRecall(
    recallPlaybook,
    recallQuery || "high-engagement post hooks angles"
  );
  const playbookBlock =
    playbook.length > 0
      ? `\n\nRecalled brand playbook (the law — ground the rewrite in this, do not copy verbatim):\n- ${playbook.join("\n- ")}`
      : "";

  // HUMAN_FEEDBACK_IS_LAW: a human steer outranks the rubric for this revision.
  const feedbackBlock =
    feedback && feedback.trim().length > 0
      ? `\n\nHUMAN FEEDBACK (TOP PRIORITY — satisfy this first, then the rubric):\n${feedback.trim()}`
      : "";

  const grounding = [
    `Campaign strategy (DNA):\n${renderStrategy(strategy)}`,
    `Funnel layer to populate:\n${FUNNEL_LAYER_GUIDANCE[layer]}`,
    `The SINGLE allowed CTA for this layer: ${FUNNEL_LAYER_CTA[layer]}`,
    `Research findings:\n${renderFindings(findings)}${playbookBlock}${feedbackBlock}`,
  ].join("\n\n");

  const draftsForModel = JSON.stringify([
    { topic: draft.topic, angle: draft.angle, text: draft.text },
  ]);
  const user = [grounding, `Draft posts to critique and rewrite:\n${draftsForModel}`].join(
    "\n\n"
  );
  const refineSystem = REFINE_PROMPT.replace(/\{cta\}/g, FUNNEL_LAYER_CTA[layer]);

  let revisedRaw: string;
  try {
    revisedRaw = await complete({ system: refineSystem, user });
  } catch {
    return null; // FAIL_SAFE: a refine error keeps the caller's original draft.
  }

  const revised = parseDraftPosts(revisedRaw, layer, 1, 1);
  return revised[0] ?? null;
}

/**
 * Run the GENERATE activity for a campaign: populate the funnel with a quality loop.
 *
 * 1. Recall the brand playbook from the knowledge hub (injected, fail-open).
 * 2. For EACH funnel layer, derive its draft count from `funnelTargets` (no hardcoded N).
 * 3. DRAFT pass: one LLM call per (non-empty) layer → `count` DISTINCT, playbook- and
 *    DNA-grounded, Hook–Body–CTA posts with EXACTLY ONE layer-matched CTA (revision 0).
 * 4. REFINE pass (CRITIQUE_THEN_REVISE): one MORE bounded LLM call per layer that
 *    critiques the batch on a named rubric (hook strength, single-CTA, on-voice,
 *    value-equation, no-bait) and REWRITES it (revision 1). Fail-open to the draft batch.
 *
 * Returns the flattened, refined draft posts across layers; persistence as `posts`
 * (status 'generated', account-scoped) is the caller's job. Pure aside from the
 * injected callables — the refine pass uses the SAME injected `complete` (gated facade).
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
    refine = true,
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
      ? `\n\nRecalled brand playbook (the law — ground every post in this, do not copy verbatim):\n- ${playbook.join("\n- ")}`
      : "";

  const strategyBlock = renderStrategy(strategy);
  const findingsBlock = renderFindings(findings);

  const drafts: DraftPost[] = [];
  // POPULATE_THE_FUNNEL: draft+refine per layer, count DERIVED from funnelTargets.
  for (const layer of FUNNEL_LAYERS) {
    const count = resolveLayerCount(
      layer,
      funnelTargets,
      defaultPerLayer,
      maxPerLayer
    );
    if (count <= 0) continue;

    // Shared grounding (campaign DNA + layer role + the layer's SINGLE allowed CTA +
    // findings + playbook) — handed to BOTH the draft and the refine pass so the
    // editor critiques against the exact same constraints the writer was given.
    const grounding = [
      `Campaign strategy (DNA):\n${strategyBlock}`,
      `Funnel layer to populate:\n${FUNNEL_LAYER_GUIDANCE[layer]}`,
      `The SINGLE allowed CTA for this layer: ${FUNNEL_LAYER_CTA[layer]}`,
      `Research findings:\n${findingsBlock}${playbookBlock}`,
    ].join("\n\n");

    // DRAFT pass — count + the layer CTA are stamped into the system prompt.
    const draftSystem = GENERATE_PROMPT.replace(/\{count\}/g, String(count)).replace(
      /\{cta\}/g,
      FUNNEL_LAYER_CTA[layer]
    );
    const draftRaw = await complete({ system: draftSystem, user: grounding });
    const layerDrafts = parseDraftPosts(draftRaw, layer, count, 0);

    // REFINE pass — one bounded critique→revise call, fail-open to the draft batch.
    const refined =
      refine && layerDrafts.length > 0
        ? await refineDraftBatch(
            complete,
            layer,
            layerDrafts,
            REFINE_PROMPT.replace(/\{cta\}/g, FUNNEL_LAYER_CTA[layer]),
            grounding
          )
        : layerDrafts;

    drafts.push(...refined);
  }

  return drafts;
}
