// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-research/workflow`
 * Purpose: The RESEARCH activity of the beacon growth loop — a thin, one-pass
 *   workflow that turns a campaign's strategy into a handful of structured tenant
 *   `findings`. RESEARCH_IS_AN_ACTIVITY: this is a workflow, not a table; the route
 *   persists its output rows account-scoped (see the research route).
 * Scope: Pure orchestration. Recall generic playbook (injected) → ground the strategy
 *   → one LLM call → parse to typed findings. Does NOT touch the DB, env, HTTP, or
 *   Doltgres directly — all I/O is injected (mirrors the content graph's pure factory).
 * Invariants:
 *   - PURE_ORCHESTRATION: no side effects beyond the injected callables; no env reads.
 *   - INJECTED_IO: `complete` (LLM) and optional `recallPlaybook` (Dolt) are injected,
 *     so unit tests run with fakes and the package stays decoupled from app ports.
 *   - V0_SYNTHESIZED_KINDS: only insight/pain_point/angle are produced here; the
 *     CHECK-reserved exemplar/reference kinds await the deferred web-search pass.
 *   - FAIL_OPEN_RECALL: a recall failure degrades to no-playbook, never throws — the
 *     activity must still produce findings on a fresh/empty knowledge hub.
 *   - PACKAGES_NO_SRC_IMPORTS: no imports from src/**
 * Side-effects: none (all I/O injected)
 * Links: docs/spec/beacon-growth-loop-v0.md §2.2/§3/§7, ./prompts.ts
 * @public
 */

import {
  RESEARCH_FINDING_KINDS,
  RESEARCH_PROMPT,
  type ResearchFindingKind,
} from "./prompts";

/** The campaign strategy fields that ground the research (from the `campaigns` row). */
export interface CampaignStrategy {
  /** Campaign slug — stamped onto every persisted finding by the caller. */
  campaignId: string;
  /** Brand voice / tone; nullable on the row. */
  voice?: string | null;
  /** Core subject the campaign orbits; nullable. */
  coreTopic?: string | null;
  /** Ideal-customer profile / target audience; nullable. */
  icp?: string | null;
  /** What the campaign is trying to achieve; nullable. */
  objective?: string | null;
}

/** One synthesized research finding (the v0 synthesized kinds only). */
export interface ResearchFinding {
  kind: ResearchFindingKind;
  content: string;
}

/**
 * Injected LLM call: a single system+user completion returning plain text.
 * The app wraps `LlmService.completion` into this shape; tests inject a fake.
 */
export type CompleteFn = (input: {
  system: string;
  user: string;
}) => Promise<string>;

/**
 * Injected playbook recall: pull a few generic, reusable notes from the Dolt
 * knowledge hub to ground the activity. Returns short strings (titles/excerpts).
 * Optional — the activity FAIL_OPEN_RECALLs to no-playbook if absent or failing.
 */
export type RecallPlaybookFn = (query: string) => Promise<string[]>;

export interface RunGrowthResearchInput {
  strategy: CampaignStrategy;
  complete: CompleteFn;
  recallPlaybook?: RecallPlaybookFn;
  /** Hard cap on findings returned (defensive; the prompt already aims for 5-7). */
  maxFindings?: number;
}

const DEFAULT_MAX_FINDINGS = 10;

const FINDING_KIND_SET: ReadonlySet<string> = new Set(RESEARCH_FINDING_KINDS);

/** Render the campaign strategy as a compact, labelled brief for the model. */
function renderStrategy(s: CampaignStrategy): string {
  const lines = [
    `core_topic: ${s.coreTopic?.trim() || "(unspecified)"}`,
    `voice: ${s.voice?.trim() || "(unspecified)"}`,
    `icp: ${s.icp?.trim() || "(unspecified)"}`,
    `objective: ${s.objective?.trim() || "(unspecified)"}`,
  ];
  return lines.join("\n");
}

/** Best-effort recall — never throws; an empty/failed hub yields no playbook. */
async function safeRecall(
  recall: RecallPlaybookFn | undefined,
  query: string
): Promise<string[]> {
  if (!recall) return [];
  try {
    const notes = await recall(query);
    return notes.filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Parse the model's JSON array into typed findings. Tolerant: ignores non-JSON,
 * drops rows missing a valid kind or content, trims content. Never throws.
 */
export function parseFindings(raw: string): ResearchFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ResearchFinding[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind;
    const content = rec.content;
    if (typeof kind !== "string" || !FINDING_KIND_SET.has(kind)) continue;
    if (typeof content !== "string" || content.trim().length === 0) continue;
    out.push({ kind: kind as ResearchFindingKind, content: content.trim() });
  }
  return out;
}

/**
 * Run the one-pass research activity for a campaign.
 *
 * 1. Recall generic brand-voice/playbook from the knowledge hub (injected, fail-open).
 * 2. Ground the campaign strategy + playbook into a single research prompt.
 * 3. One LLM call → parse to typed `findings` (insight/pain_point/angle).
 *
 * Returns the structured findings; persistence (account-scoped rows) is the caller's
 * job. Pure aside from the injected callables.
 */
export async function runGrowthResearch(
  input: RunGrowthResearchInput
): Promise<ResearchFinding[]> {
  const { strategy, complete, recallPlaybook, maxFindings } = input;

  const recallQuery = [strategy.coreTopic, strategy.icp, "brand voice hooks angles"]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(" ");
  const playbook = await safeRecall(recallPlaybook, recallQuery || "brand voice hooks angles");

  const playbookBlock =
    playbook.length > 0
      ? `\n\nRecalled generic playbook (apply customized, do not copy):\n- ${playbook.join("\n- ")}`
      : "";

  const user = `Campaign strategy:\n${renderStrategy(strategy)}${playbookBlock}`;

  const text = await complete({ system: RESEARCH_PROMPT, user });
  const findings = parseFindings(text);

  const cap = maxFindings ?? DEFAULT_MAX_FINDINGS;
  return findings.slice(0, cap);
}
