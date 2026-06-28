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
  RESEARCH_FINDING_KINDS,
  runGrowthResearch,
  type TenantSocialContext,
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
  it("supports the full C0 finding kind set", () => {
    expect(RESEARCH_FINDING_KINDS).toEqual([
      "insight",
      "pain_point",
      "angle",
      "exemplar",
      "reference",
    ]);
  });

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

  it("requires injected source refs for exemplar and reference findings", () => {
    const raw = JSON.stringify([
      { kind: "insight", content: "The audience needs proof before tactics." },
      {
        kind: "exemplar",
        content: "This owned post is the pattern.",
        sourceRef: "post:1",
      },
      {
        kind: "reference",
        content: "The playbook says to lead with tension.",
      },
      {
        kind: "exemplar",
        content: "Unsupported handle.",
        sourceRef: "@made-up",
      },
      {
        kind: "angle",
        content: "Show the before/after measurement gap.",
        metadata: { basis: ["post:1"], scoreHint: 0.8 },
      },
    ]);

    expect(parseFindings(raw, { allowedSourceRefs: ["post:1"] })).toEqual([
      { kind: "insight", content: "The audience needs proof before tactics." },
      {
        kind: "exemplar",
        content: "This owned post is the pattern.",
        sourceRef: "post:1",
      },
      {
        kind: "angle",
        content: "Show the before/after measurement gap.",
        metadata: { basis: ["post:1"], scoreHint: 0.8 },
      },
    ]);
  });
});

describe("runGrowthResearch - workflow", () => {
  it("produces typed findings from the LLM output", async () => {
    const complete = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          kind: "insight",
          content: "an insight",
          metadata: { nextAction: "Generate drafts from the clearest insight." },
        },
        { kind: "angle", content: "an angle" },
      ])
    );

    const out = await runGrowthResearch({ strategy: STRATEGY, complete });

    expect(out).toEqual([
      {
        kind: "insight",
        content: "an insight",
        metadata: { nextAction: "Generate drafts from the clearest insight." },
      },
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
      .mockResolvedValue(
        JSON.stringify([
          {
            kind: "angle",
            content: "x",
            metadata: { nextAction: "Test this angle in one draft." },
          },
        ])
      );
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
      .mockResolvedValue(
        JSON.stringify([
          {
            kind: "insight",
            content: "y",
            metadata: { nextAction: "Turn this insight into one draft." },
          },
        ])
      );
    const recallPlaybook = vi.fn().mockRejectedValue(new Error("hub down"));

    const out = await runGrowthResearch({
      strategy: STRATEGY,
      complete,
      recallPlaybook,
    });

    expect(out).toEqual([
      {
        kind: "insight",
        content: "y",
        metadata: { nextAction: "Turn this insight into one draft." },
      },
    ]);
  });

  it("honors the maxFindings cap", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      kind: "angle",
      content: `angle ${i}`,
      ...(i === 0
        ? { metadata: { nextAction: "Use the top angle for the next draft." } }
        : {}),
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

  it("returns [] when the LLM omits an actionable next step", async () => {
    const complete = vi.fn().mockResolvedValue(
      JSON.stringify([
        { kind: "insight", content: "an insight with no next action" },
        { kind: "angle", content: "an angle with no next action" },
      ])
    );
    const out = await runGrowthResearch({ strategy: STRATEGY, complete });
    expect(out).toEqual([]);
  });

  it("grounds research with tenant social context and drops hallucinated sources", async () => {
    const socialContext: TenantSocialContext = {
      connectedAccounts: [
        {
          sourceRef: "connection:moltbook-main",
          platform: "moltbook",
          handle: "@beacon",
          metricsSnapshot: { followers: 1200 },
        },
      ],
      recentPosts: [
        {
          sourceRef: "post:owned-1",
          platform: "moltbook",
          text: "Most teams do not need more posts; they need proof that one angle moved the right audience.",
          funnelLayer: "tofu",
          metrics: { impressions: 900, saves: 18 },
        },
      ],
      existingFindings: [
        {
          sourceRef: "finding:prior-1",
          kind: "insight",
          content: "Measurement language outperformed generic automation language.",
        },
      ],
      postedDraftMetrics: [
        {
          sourceRef: "draft:posted-1",
          platform: "moltbook",
          funnelLayer: "mofu",
          text: "Draft about audience proof.",
          metrics: { clicks: 14, replies: 3 },
        },
      ],
      funnelTargets: { tofu: 2, mofu: 1, bofu: 1 },
    };

    let userPrompt = "";
    const out = await runGrowthResearch({
      strategy: {
        ...STRATEGY,
        brief: "Help founders understand Beacon as measured growth intelligence.",
      },
      socialContext,
      recallPlaybook: async () => ["Use proof-bearing hooks before claims."],
      complete: async ({ user }) => {
        userPrompt = user;
        return JSON.stringify([
          {
            kind: "insight",
            content: "Technical founders respond when measurement is framed as risk reduction.",
            metadata: {
              basis: ["post:owned-1", "draft:posted-1"],
              nextAction:
                "Generate three drafts that frame measurement as risk reduction.",
            },
          },
          {
            kind: "exemplar",
            content: "The owned post turns volume skepticism into a measurement argument.",
            sourceRef: "post:owned-1",
            metadata: { funnelLayer: "tofu" },
          },
          {
            kind: "reference",
            content: "Lead with proof-bearing hooks before claims.",
            sourceRef: "playbook:0",
          },
          {
            kind: "reference",
            content: "Invented external article.",
            sourceRef: "https://fake.example/article",
          },
        ]);
      },
    });

    expect(userPrompt).toContain("Tenant social context");
    expect(userPrompt).toContain("post:owned-1");
    expect(userPrompt).toContain("draft:posted-1");
    expect(userPrompt).toContain("playbook:0");
    expect(userPrompt).toContain('"tofu":2');
    expect(out).toEqual([
      {
        kind: "insight",
        content: "Technical founders respond when measurement is framed as risk reduction.",
        metadata: {
          basis: ["post:owned-1", "draft:posted-1"],
          nextAction:
            "Generate three drafts that frame measurement as risk reduction.",
        },
      },
      {
        kind: "exemplar",
        content: "The owned post turns volume skepticism into a measurement argument.",
        sourceRef: "post:owned-1",
        metadata: { funnelLayer: "tofu" },
      },
      {
        kind: "reference",
        content: "Lead with proof-bearing hooks before claims.",
        sourceRef: "playbook:0",
      },
    ]);
  });
});
