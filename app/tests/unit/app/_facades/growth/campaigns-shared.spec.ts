// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/_facades/growth/campaigns-shared`
 * Purpose: Lock the pipeline-board column model — `postStage` maps every draft
 *   `posts.status` to exactly one board column, and `PIPELINE_STAGES` orders the
 *   columns left→right as the growth loop flows. This is the contract the Kanban
 *   board (CampaignBoard) renders against.
 * Scope: Pure function tests — no DOM, no I/O, no mocks.
 * Invariants:
 *   - TOTALITY: any status (incl. unknown) resolves to a real draft column.
 *   - COLLAPSE_TRANSIENTS: generated/refining/in_review share the Drafts lane;
 *     rejected/failed share the Rejected drawer.
 * Side-effects: none
 * Links: app/src/app/_facades/growth/campaigns.shared.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  type DraftStage,
  PIPELINE_STAGES,
  postStage,
} from "@/app/_facades/growth/campaigns.shared";

describe("postStage — draft status → board column", () => {
  it("routes approved to Ready and posted to Posted", () => {
    expect(postStage("approved")).toBe("ready");
    expect(postStage("posted")).toBe("posted");
  });

  it("collapses rejected AND failed into the Rejected drawer", () => {
    expect(postStage("rejected")).toBe("rejected");
    expect(postStage("failed")).toBe("rejected");
  });

  it("collapses generated / refining / in_review into the single Drafts lane", () => {
    expect(postStage("generated")).toBe("drafts");
    expect(postStage("refining")).toBe("drafts");
    expect(postStage("in_review")).toBe("drafts");
  });

  it("defaults an unknown status to Drafts rather than dropping the card", () => {
    expect(postStage("something_new")).toBe("drafts");
  });

  it("only ever yields a real draft column (never `opportunities`)", () => {
    const draftColumns = PIPELINE_STAGES.filter(
      (s): s is DraftStage => s !== "opportunities"
    );
    for (const status of [
      "generated",
      "refining",
      "in_review",
      "approved",
      "posted",
      "rejected",
      "failed",
      "weird",
    ]) {
      expect(draftColumns).toContain(postStage(status));
    }
  });
});

describe("PIPELINE_STAGES — board column order", () => {
  it("orders the columns left→right as the growth loop flows", () => {
    expect([...PIPELINE_STAGES]).toEqual([
      "opportunities",
      "drafts",
      "ready",
      "posted",
      "rejected",
    ]);
  });
});
