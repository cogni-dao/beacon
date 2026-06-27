// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-research/workflow`
 * Purpose: The RESEARCH activity of the beacon growth loop — a thin, one-pass
 *   workflow that turns a campaign's strategy and tenant social evidence into a
 *   handful of structured tenant `findings`. RESEARCH_IS_AN_ACTIVITY: this is a
 *   workflow, not a table; the route persists its output rows account-scoped (see
 *   the research route).
 * Scope: Pure orchestration. Recall generic playbook (injected) → ground the strategy
 *   and tenant social context → one LLM call → parse to typed findings. Does NOT
 *   touch the DB, env, HTTP, or Doltgres directly — all I/O is injected (mirrors the
 *   content graph's pure factory).
 * Invariants:
 *   - PURE_ORCHESTRATION: no side effects beyond the injected callables; no env reads.
 *   - INJECTED_IO: `complete` (LLM) and optional `recallPlaybook` (Dolt) are injected,
 *     so unit tests run with fakes and the package stays decoupled from app ports.
 *   - SOURCE_REF_FIREWALL: exemplar/reference findings must cite a sourceRef that
 *     was injected into the prompt; unsupported sourceRefs are dropped.
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
  /**
   * The human's plain-English campaign brief (the `campaigns.brief` field the
   * create form actually collects). This is the PRIMARY grounding in v0 — the
   * structured fields below are optional refinements layered on top of it.
   */
  brief?: string | null;
  /** Brand voice / tone; nullable on the row. */
  voice?: string | null;
  /** Core subject the campaign orbits; nullable. */
  coreTopic?: string | null;
  /** Ideal-customer profile / target audience; nullable. */
  icp?: string | null;
  /** What the campaign is trying to achieve; nullable. */
  objective?: string | null;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

/** A connected owned-account snapshot already loaded by the caller. */
export interface ConnectedAccountSnapshot {
  /** Stable caller-owned evidence id, e.g. `connection:<id>`. Falls back to `account:<index>`. */
  sourceRef?: string | null;
  platform: string;
  handle?: string | null;
  displayName?: string | null;
  profileUrl?: string | null;
  metricsSnapshot?: JsonObject | null;
  capturedAt?: string | null;
}

/** A recent owned/social post plus any cached metrics already loaded by the caller. */
export interface OwnedSocialPostSnapshot {
  /** Stable caller-owned evidence id, e.g. `post:<id>`. Falls back to `post:<index>`. */
  sourceRef?: string | null;
  platform: string;
  postId?: string | null;
  url?: string | null;
  text?: string | null;
  publishedAt?: string | null;
  funnelLayer?: string | null;
  metrics?: JsonObject | null;
}

/** An already-known campaign finding that can ground this research pass. */
export interface ExistingResearchFinding {
  /** Stable caller-owned evidence id, e.g. `finding:<id>`. Falls back to `finding:<index>`. */
  sourceRef?: string | null;
  kind?: string | null;
  content: string;
  metadata?: JsonObject | null;
  createdAt?: string | null;
}

/** A generated/posted draft and realized metrics already loaded by the caller. */
export interface PostedDraftMetricSnapshot {
  /** Stable caller-owned evidence id, e.g. `draft:<id>`. Falls back to `draft:<index>`. */
  sourceRef?: string | null;
  platform?: string | null;
  postId?: string | null;
  draftId?: string | null;
  text?: string | null;
  funnelLayer?: string | null;
  metrics?: JsonObject | null;
  measuredAt?: string | null;
}

/** Per-funnel-layer target values loaded by the caller. */
export type ResearchFunnelTargets = Record<string, number>;

/** Tenant-owned evidence available to this bounded research activity. */
export interface TenantSocialContext {
  connectedAccounts?: readonly ConnectedAccountSnapshot[];
  recentPosts?: readonly OwnedSocialPostSnapshot[];
  existingFindings?: readonly ExistingResearchFinding[];
  postedDraftMetrics?: readonly PostedDraftMetricSnapshot[];
  funnelTargets?: ResearchFunnelTargets | null;
}

/** One research finding emitted by this activity. */
export interface ResearchFinding {
  kind: ResearchFindingKind;
  content: string;
  /**
   * Evidence reference copied from the injected sourceRefs. Required for
   * exemplar/reference; optional for synthesized insight/pain_point/angle.
   */
  sourceRef?: string;
  /** Plain JSON metadata for evidence basis, funnel layer, KPI hints, etc. */
  metadata?: JsonObject;
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
  /** Tenant-owned social/campaign evidence already loaded by the caller. */
  socialContext?: TenantSocialContext;
  complete: CompleteFn;
  recallPlaybook?: RecallPlaybookFn;
  /** Hard cap on findings returned (defensive; the prompt already aims for 5-7). */
  maxFindings?: number;
}

const DEFAULT_MAX_FINDINGS = 10;

const FINDING_KIND_SET: ReadonlySet<string> = new Set(RESEARCH_FINDING_KINDS);
const SOURCE_REQUIRED_KINDS: ReadonlySet<string> = new Set(["exemplar", "reference"]);

/** Render the campaign strategy as a compact, labelled brief for the model. */
function renderStrategy(s: CampaignStrategy): string {
  const lines = [
    `brief (the campaign description — ground everything in this): ${s.brief?.trim() || "(none given)"}`,
    `core_topic: ${s.coreTopic?.trim() || "(derive from the brief)"}`,
    `voice: ${s.voice?.trim() || "(derive from the brief)"}`,
    `icp: ${s.icp?.trim() || "(derive from the brief)"}`,
    `objective: ${s.objective?.trim() || "(derive from the brief)"}`,
  ];
  return lines.join("\n");
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compactText(value: string | null | undefined, max = 500): string | null {
  if (!hasText(value)) return null;
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function jsonSummary(value: JsonObject | null | undefined, max = 700): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return null;
  }
}

function sourceRef(provided: string | null | undefined, fallback: string): string {
  return compactText(provided, 180) ?? fallback;
}

function pushLabeledField(
  fields: string[],
  label: string,
  value: string | null | undefined
): void {
  const text = compactText(value, 260);
  if (text) fields.push(`${label}=${text}`);
}

function pushJsonField(
  fields: string[],
  label: string,
  value: JsonObject | null | undefined
): void {
  const text = jsonSummary(value);
  if (text) fields.push(`${label}=${text}`);
}

function renderTenantSocialContext(context: TenantSocialContext | undefined): {
  block: string;
  sourceRefs: string[];
} {
  if (!context) {
    return { block: "Tenant social context:\n(none supplied)", sourceRefs: [] };
  }

  const sections: string[] = [];
  const refs: string[] = [];

  const accounts = context.connectedAccounts ?? [];
  if (accounts.length > 0) {
    const lines = accounts.map((account, i) => {
      const ref = sourceRef(account.sourceRef, `account:${i}`);
      refs.push(ref);
      const fields = [`[${ref}]`, `platform=${account.platform}`];
      pushLabeledField(fields, "handle", account.handle);
      pushLabeledField(fields, "displayName", account.displayName);
      pushLabeledField(fields, "profileUrl", account.profileUrl);
      pushLabeledField(fields, "capturedAt", account.capturedAt);
      pushJsonField(fields, "metrics", account.metricsSnapshot);
      return `- ${fields.join(" ")}`;
    });
    sections.push(`Connected account snapshots:\n${lines.join("\n")}`);
  }

  const posts = context.recentPosts ?? [];
  if (posts.length > 0) {
    const lines = posts.map((post, i) => {
      const ref = sourceRef(post.sourceRef, `post:${i}`);
      refs.push(ref);
      const fields = [`[${ref}]`, `platform=${post.platform}`];
      pushLabeledField(fields, "postId", post.postId);
      pushLabeledField(fields, "url", post.url);
      pushLabeledField(fields, "publishedAt", post.publishedAt);
      pushLabeledField(fields, "funnelLayer", post.funnelLayer);
      pushLabeledField(fields, "text", post.text);
      pushJsonField(fields, "metrics", post.metrics);
      return `- ${fields.join(" ")}`;
    });
    sections.push(`Recent owned posts and metrics:\n${lines.join("\n")}`);
  }

  const findings = context.existingFindings ?? [];
  if (findings.length > 0) {
    const lines = findings
      .filter((finding) => hasText(finding.content))
      .map((finding, i) => {
        const ref = sourceRef(finding.sourceRef, `finding:${i}`);
        refs.push(ref);
        const fields = [`[${ref}]`];
        pushLabeledField(fields, "kind", finding.kind);
        pushLabeledField(fields, "createdAt", finding.createdAt);
        pushLabeledField(fields, "content", finding.content);
        pushJsonField(fields, "metadata", finding.metadata);
        return `- ${fields.join(" ")}`;
      });
    if (lines.length > 0) {
      sections.push(`Existing campaign findings:\n${lines.join("\n")}`);
    }
  }

  const draftMetrics = context.postedDraftMetrics ?? [];
  if (draftMetrics.length > 0) {
    const lines = draftMetrics.map((metric, i) => {
      const ref = sourceRef(metric.sourceRef, `draft:${i}`);
      refs.push(ref);
      const fields = [`[${ref}]`];
      pushLabeledField(fields, "platform", metric.platform);
      pushLabeledField(fields, "postId", metric.postId);
      pushLabeledField(fields, "draftId", metric.draftId);
      pushLabeledField(fields, "funnelLayer", metric.funnelLayer);
      pushLabeledField(fields, "measuredAt", metric.measuredAt);
      pushLabeledField(fields, "text", metric.text);
      pushJsonField(fields, "metrics", metric.metrics);
      return `- ${fields.join(" ")}`;
    });
    sections.push(`Posted draft metrics:\n${lines.join("\n")}`);
  }

  const targets = jsonSummary(context.funnelTargets ?? null);
  if (targets) {
    sections.push(`Funnel targets:\n${targets}`);
  }

  const uniqueRefs = [...new Set(refs)];
  const allowed =
    uniqueRefs.length > 0
      ? `Allowed sourceRefs for source-backed findings:\n- ${uniqueRefs.join("\n- ")}`
      : "Allowed sourceRefs for source-backed findings:\n(none)";

  return {
    block: `Tenant social context:\n${sections.join("\n\n") || "(none supplied)"}\n\n${allowed}`,
    sourceRefs: uniqueRefs,
  };
}

function renderPlaybook(playbook: readonly string[]): {
  block: string;
  sourceRefs: string[];
} {
  if (playbook.length === 0) return { block: "", sourceRefs: [] };
  const refs: string[] = [];
  const lines = playbook.map((note, i) => {
    const ref = `playbook:${i}`;
    refs.push(ref);
    return `- [${ref}] ${note.trim()}`;
  });
  return {
    block: `\n\nRecalled generic playbook (apply customized, do not copy):\n${lines.join("\n")}`,
    sourceRefs: refs,
  };
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
 * Extract a JSON array from a model response that may be wrapped in markdown code
 * fences or surrounded by prose. gpt-4o-mini frequently returns ```json [...] ```
 * (or a sentence + the array) despite "return ONLY a JSON array" — without this,
 * the parse fails and the activity silently produces ZERO rows. Shared by the
 * generate workflow's parser too.
 */
export function extractJsonArray(raw: string): string {
  let s = raw.trim();
  // Strip a leading ```/```json fence and a trailing ``` fence.
  s = s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // If prose surrounds the array, slice to the outermost [ ... ].
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  return s;
}

/**
 * Parse the model's JSON array into typed findings. Tolerant: ignores non-JSON,
 * drops rows missing a valid kind or content, trims content. Never throws.
 */
export interface ParseFindingsOptions {
  /**
   * When supplied, any sourceRef on a finding must match one of these injected refs.
   * This prevents the model from inventing URLs, handles, or opaque competitors as sources.
   */
  allowedSourceRefs?: ReadonlySet<string> | readonly string[];
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (t !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

function makeAllowedSourceSet(
  refs: ParseFindingsOptions["allowedSourceRefs"]
): ReadonlySet<string> | undefined {
  if (!refs) return undefined;
  return refs instanceof Set ? refs : new Set(refs);
}

export function parseFindings(
  raw: string,
  options: ParseFindingsOptions = {}
): ResearchFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonArray(raw));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const allowedSourceRefs = makeAllowedSourceSet(options.allowedSourceRefs);
  const out: ResearchFinding[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind;
    const content = rec.content;
    if (typeof kind !== "string" || !FINDING_KIND_SET.has(kind)) continue;
    if (typeof content !== "string" || content.trim().length === 0) continue;

    const rawSourceRef = rec.sourceRef;
    const ref = typeof rawSourceRef === "string" ? rawSourceRef.trim() : "";
    if (ref && allowedSourceRefs && !allowedSourceRefs.has(ref)) continue;
    if (SOURCE_REQUIRED_KINDS.has(kind) && ref.length === 0) continue;

    const finding: ResearchFinding = {
      kind: kind as ResearchFindingKind,
      content: content.trim(),
    };
    if (ref) finding.sourceRef = ref;
    if (isJsonObject(rec.metadata)) finding.metadata = rec.metadata;
    out.push(finding);
  }
  return out;
}

function hasRecommendedNextAction(findings: readonly ResearchFinding[]): boolean {
  return findings.some((finding) => {
    const action = finding.metadata?.nextAction;
    return typeof action === "string" && action.trim().length > 0;
  });
}

/**
 * Run the one-pass research activity for a campaign.
 *
 * 1. Recall generic brand-voice/playbook from the knowledge hub (injected, fail-open).
 * 2. Ground the campaign strategy + tenant social evidence + playbook into a
 *    single research prompt.
 * 3. One LLM call → parse to typed `findings`, enforcing the injected sourceRef list.
 *
 * Returns the structured findings; persistence (account-scoped rows) is the caller's
 * job. Pure aside from the injected callables.
 */
export async function runGrowthResearch(
  input: RunGrowthResearchInput
): Promise<ResearchFinding[]> {
  const { strategy, socialContext, complete, recallPlaybook, maxFindings } = input;

  const recallQuery = [strategy.coreTopic, strategy.icp, "brand voice hooks angles"]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(" ");
  const playbook = await safeRecall(recallPlaybook, recallQuery || "brand voice hooks angles");

  const social = renderTenantSocialContext(socialContext);
  const playbookRendered = renderPlaybook(playbook);
  const allowedSourceRefs = new Set([
    ...social.sourceRefs,
    ...playbookRendered.sourceRefs,
  ]);
  const sourceRefBlock =
    playbookRendered.sourceRefs.length > 0
      ? `\n\nAdditional allowed playbook sourceRefs:\n- ${playbookRendered.sourceRefs.join("\n- ")}`
      : "";

  const user = `Campaign strategy:\n${renderStrategy(strategy)}\n\n${social.block}${sourceRefBlock}${playbookRendered.block}`;

  const text = await complete({ system: RESEARCH_PROMPT, user });
  const findings = parseFindings(text, { allowedSourceRefs });
  if (findings.length > 0 && !hasRecommendedNextAction(findings)) {
    return [];
  }

  const cap = maxFindings ?? DEFAULT_MAX_FINDINGS;
  return findings.slice(0, cap);
}
