// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/growth/campaigns.shared`
 * Purpose: CLIENT-SAFE growth constants/types shared by the server facade and the
 *   "use client" funnel UI. These carry NO server deps (no db, no LLM, no
 *   bootstrap) so importing them into a client component does not drag Node
 *   built-ins (fs/child_process/dns) into the browser bundle — the build failure
 *   that occurred when the funnel UI imported FUNNEL_LAYERS from campaigns.server.
 * Scope: pure constants + types. No I/O, no imports.
 * Side-effects: none
 * @public
 */

/** The funnel layers, ordered top→bottom. Client-safe (no server deps). */
export const FUNNEL_LAYERS = ["tofu", "mofu", "bofu"] as const;
export type FunnelLayer = (typeof FUNNEL_LAYERS)[number];

/**
 * The campaign detail board's pipeline stages, ordered left→right to mirror the
 * loop the hub defines (INTELLIGENCE → GENERATE → REVIEW → APPROVED POST → MEASURE):
 *   opportunities → drafts → ready → posted, with rejected as a collapsed drawer.
 * These are the Kanban COLUMNS. `opportunities` is pre-draft (findings/priorities +
 * capture); the other four are the draft (`posts.status`) lifecycle grouped into
 * review lanes. Client-safe (no server deps) so the board UI can import it.
 */
export const PIPELINE_STAGES = [
  "opportunities",
  "drafts",
  "ready",
  "posted",
  "rejected",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The four stages that hold drafts (everything except pre-draft `opportunities`). */
export type DraftStage = Exclude<PipelineStage, "opportunities">;

/**
 * Map a `posts.status` to its board column. The raw lifecycle has more states than
 * columns on purpose: `generated`/`refining`/`in_review` all read as "still being
 * worked" and collapse into the single **Drafts** review lane; `failed` sits with
 * `rejected` (both are "not going out"). Keeps the board legible without losing the
 * finer status, which the card badge still shows verbatim.
 */
export function postStage(status: string): DraftStage {
  switch (status) {
    case "approved":
      return "ready";
    case "posted":
      return "posted";
    case "rejected":
    case "failed":
      return "rejected";
    default:
      // generated | refining | in_review
      return "drafts";
  }
}
