// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/langgraph-graphs/growth-research`
 * Purpose: Unit-test the beacon growth-loop RESEARCH activity (`runGrowthResearch`)
 *   — prove its findings OUTPUT SHAPE: only valid kinds survive, content is trimmed,
 *   recall is fed to the LLM, recall failures fail-open, and the cap is honored.
 * Scope: Pure workflow with injected fakes (no LLM, no DB, no network). Does not
 *   exercise the HTTP route or persistence — that is the component RLS lane.
 * Invariants:
 *   - V0_SYNTHESIZED_KINDS: rows with kinds outside insight/pain_point/angle drop.
 *   - PARSE_TOLERANT: non-JSON / malformed rows are dropped, never throw.
 *   - FAIL_OPEN_RECALL: a throwing recall still yields findings.
 *   - RECALL_GROUNDS_PROMPT: recalled playbook reaches the LLM user message.
 * Side-effects: none
 * Links: packages/langgraph-graphs/src/graphs/growth-research/workflow.ts,
 *         docs/spec/beacon-growth-loop-v0.md §2.2/§3
 * @internal
 */

import {
  type CampaignStrategy,
  parseFindings,
  runGrowthResearch,
} from "@cogni/langgraph-graphs";
import { describe, expect, it, vi } from "vitest";

const STRATEGY: CampaignStrategy = {
  campaignId: "demo",
  voice: "punchy and direct",
  coreTopic: "AI agent ownership",
  icp: "indie SaaS founders",
  objective: "signups",
};

describe("parseFindings - output shape", () => {
  it("keeps only valid kinds and trims content", () => {
    const raw = JSON.stringify([
      { kind: "insight", content: "  founders distrust black-box AI  " },
      { kind: "pain_point", content: "manual posting eats their week" },
      { kind: "angle", content: "own your distribution" },
      { kind: "exemplar", content: "deferred kind — drop in v0" },
      { kind: "bogus", content: "unknown kind" },
      { kind: "insight", content: "" },
      { content: "missing kind" },
      "not an object",
    ]);
    const out = parseFindings(raw);
    expect(out).toEqual([
      { kind: "insight", content: "founders distrust black-box AI" },
      { kind: "pain_point", content: "manual posting eats their week" },
      { kind: "angle", content: "own your distribution" },
    ]);
  });

  it("returns [] for non-JSON and non-array", () => {
    expect(parseFindings("not json at all")).toEqual([]);
    expect(parseFindings(JSON.stringify({ kind: "insight" }))).toEqual([]);
    expect(parseFindings("")).toEqual([]);
  });
});

describe("runGrowthResearch - workflow", () => {
  it("produces typed findings from the LLM output", async () => {
    const complete = vi.fn().mockResolvedValue(
      JSON.stringify([
        { kind: "insight", content: "an insight" },
        { kind: "angle", content: "an angle" },
      ])
    );

    const out = await runGrowthResearch({ strategy: STRATEGY, complete });

    expect(out).toEqual([
      { kind: "insight", content: "an insight" },
      { kind: "angle", content: "an angle" },
    ]);
    // The strategy was rendered into the user message.
    const { system, user } = complete.mock.calls[0][0];
    expect(system).toContain("growth-marketing researcher");
    expect(user).toContain("AI agent ownership");
    expect(user).toContain("indie SaaS founders");
  });

  it("grounds the prompt with recalled playbook", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(JSON.stringify([{ kind: "angle", content: "x" }]));
    const recallPlaybook = vi
      .fn()
      .mockResolvedValue(["hook: lead with a contrarian claim"]);

    await runGrowthResearch({ strategy: STRATEGY, complete, recallPlaybook });

    expect(recallPlaybook).toHaveBeenCalledTimes(1);
    const { user } = complete.mock.calls[0][0];
    expect(user).toContain("lead with a contrarian claim");
  });

  it("fails open when recall throws (still produces findings)", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(JSON.stringify([{ kind: "insight", content: "y" }]));
    const recallPlaybook = vi.fn().mockRejectedValue(new Error("hub down"));

    const out = await runGrowthResearch({
      strategy: STRATEGY,
      complete,
      recallPlaybook,
    });

    expect(out).toEqual([{ kind: "insight", content: "y" }]);
  });

  it("honors the maxFindings cap", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      kind: "angle",
      content: `angle ${i}`,
    }));
    const complete = vi.fn().mockResolvedValue(JSON.stringify(many));

    const out = await runGrowthResearch({
      strategy: STRATEGY,
      complete,
      maxFindings: 3,
    });

    expect(out).toHaveLength(3);
  });

  it("returns [] when the LLM emits no valid findings", async () => {
    const complete = vi.fn().mockResolvedValue("garbage, not json");
    const out = await runGrowthResearch({ strategy: STRATEGY, complete });
    expect(out).toEqual([]);
  });
});
