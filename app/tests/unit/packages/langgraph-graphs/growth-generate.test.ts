// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/langgraph-graphs/growth-generate`
 * Purpose: Unit-test the beacon growth-loop GENERATE activity (`runGrowthGenerate`)
 *   — prove it POPULATES THE FUNNEL: spreads drafts across ≥2 funnel layers, DERIVES
 *   per-layer volume from `funnelTargets` (no hardcoded N), produces DISTINCT
 *   topics/angles (not duplicates), grounds the prompt with findings + recall, and
 *   fails open on recall errors.
 * Scope: Pure workflow with injected fakes (no LLM, no DB, no network). Does not
 *   exercise the HTTP route or persistence — that is the component RLS lane.
 * Invariants:
 *   - VOLUME_FROM_FUNNEL_TARGETS: per-layer count = the target; unset → modest default.
 *   - POPULATE_THE_FUNNEL: ≥2 layers covered; one variant per layer/topic, not copies.
 *   - PARSE_TOLERANT: non-JSON / malformed rows are dropped, never throw.
 *   - FAIL_OPEN_RECALL: a throwing recall still yields drafts.
 *   - FINDINGS_GROUND_PROMPT: campaign findings reach the LLM user message.
 * Side-effects: none
 * Links: packages/langgraph-graphs/src/graphs/growth-generate/workflow.ts,
 *         docs/spec/beacon-growth-loop-v0.md §0/§3/§4
 * @internal
 */

import {
  type CampaignStrategy,
  type GenerateFinding,
  parseDraftPosts,
  resolveLayerCount,
  runGrowthGenerate,
} from "@cogni/langgraph-graphs";
import { describe, expect, it, vi } from "vitest";

const STRATEGY: CampaignStrategy = {
  campaignId: "demo",
  voice: "punchy and direct",
  coreTopic: "AI agent ownership",
  icp: "indie SaaS founders",
  objective: "signups",
};

const FINDINGS: GenerateFinding[] = [
  { kind: "insight", content: "founders distrust black-box AI" },
  { kind: "angle", content: "own your distribution" },
];

/** A fake `complete` that returns `n` distinct `{topic,angle,title,text}` posts. */
function fakeCompleteFor(n: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async ({ system }: { system: string }) => {
    // The prompt is stamped with the layer count; echo distinct posts so the test
    // can assert distinctness rather than duplication.
    void system;
    const arr = Array.from({ length: n }, (_, i) => ({
      topic: `topic-${i}`,
      angle: `angle ${i}`,
      title: `Title ${i}`,
      text: `post body ${i}`,
    }));
    return JSON.stringify(arr);
  });
}

describe("resolveLayerCount - volume from funnel_targets", () => {
  it("uses the per-layer target when present", () => {
    expect(resolveLayerCount("tofu", { tofu: 3 }, 2, 10)).toBe(3);
  });

  it("falls back to the modest default when a layer target is unset", () => {
    expect(resolveLayerCount("mofu", { tofu: 3 }, 2, 10)).toBe(2);
    expect(resolveLayerCount("bofu", null, 2, 10)).toBe(2);
    expect(resolveLayerCount("tofu", undefined, 2, 10)).toBe(2);
  });

  it("ignores garbage targets and clamps to [0, max]", () => {
    expect(resolveLayerCount("tofu", { tofu: -5 }, 2, 10)).toBe(2);
    expect(
      resolveLayerCount("tofu", { tofu: Number.NaN }, 2, 10)
    ).toBe(2);
    expect(resolveLayerCount("tofu", { tofu: 999 }, 2, 10)).toBe(10);
    expect(resolveLayerCount("tofu", { tofu: 0 }, 2, 10)).toBe(0);
  });
});

describe("parseDraftPosts - output shape", () => {
  it("keeps text-bearing rows, trims, lowercases topic, caps at limit", () => {
    const raw = JSON.stringify([
      {
        topic: "Ownership",
        angle: "own it",
        title: "Distribution Ownership",
        text: "  body one  ",
      },
      { topic: "trust", angle: "build trust", text: "body two" },
      { text: "topic-less but valid, angle defaults to text slice" },
      { topic: "x", angle: "y", text: "" }, // empty text → dropped
      "not an object",
      { topic: "extra", angle: "over the cap", text: "body three" },
    ]);
    const out = parseDraftPosts(raw, "tofu", 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      funnelLayer: "tofu",
      topic: "ownership",
      angle: "own it",
      title: "Distribution Ownership",
      text: "body one",
      channel: "moltbook",
      kind: "text",
    });
    // topic-less row gets a default topic + angle derived from text.
    expect(out[2]?.topic).toBe("general");
    expect(out[2]?.angle.length).toBeGreaterThan(0);
  });

  it("returns [] for non-JSON and non-array", () => {
    expect(parseDraftPosts("not json", "tofu", 3)).toEqual([]);
    expect(parseDraftPosts(JSON.stringify({ topic: "x" }), "tofu", 3)).toEqual(
      []
    );
  });
});

describe("runGrowthGenerate - populate the funnel", () => {
  it("spreads drafts across ≥2 funnel layers (default volume when targets unset)", async () => {
    const complete = fakeCompleteFor(2);
    const out = await runGrowthGenerate({
      strategy: STRATEGY,
      findings: FINDINGS,
      complete,
      refine: false, // isolate the draft pass — volume, not the refine call-count.
    });

    const layers = new Set(out.map((p) => p.funnelLayer));
    expect(layers.size).toBeGreaterThanOrEqual(2);
    // Default of 2 per layer × 3 layers = 6 drafts; one DRAFT LLM call per layer.
    expect(out).toHaveLength(6);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(out.every((p) => p.channel === "moltbook")).toBe(true);
    expect(out.every((p) => p.status === undefined)).toBe(true); // route stamps status
  });

  it("derives per-layer volume from funnel_targets (no hardcoded N)", async () => {
    const complete = fakeCompleteFor(5); // model can return up to 5; parser caps per layer
    const out = await runGrowthGenerate({
      strategy: STRATEGY,
      findings: FINDINGS,
      funnelTargets: { tofu: 3, mofu: 1, bofu: 0 },
      complete,
      refine: false,
    });

    const byLayer = (l: string) => out.filter((p) => p.funnelLayer === l).length;
    expect(byLayer("tofu")).toBe(3);
    expect(byLayer("mofu")).toBe(1);
    expect(byLayer("bofu")).toBe(0); // zero target → layer skipped
    // bofu skipped → only 2 DRAFT LLM calls.
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("produces one variant per layer/topic — distinct, not duplicates", async () => {
    const complete = fakeCompleteFor(3);
    const out = await runGrowthGenerate({
      strategy: STRATEGY,
      findings: FINDINGS,
      funnelTargets: { tofu: 3, mofu: 3, bofu: 3 },
      complete,
      refine: false,
    });

    // Within a layer, every topic/text is distinct (coverage, not copies).
    for (const layer of ["tofu", "mofu", "bofu"]) {
      const inLayer = out.filter((p) => p.funnelLayer === layer);
      const topics = new Set(inLayer.map((p) => p.topic));
      const texts = new Set(inLayer.map((p) => p.text));
      expect(topics.size).toBe(inLayer.length);
      expect(texts.size).toBe(inLayer.length);
    }
  });

  it("grounds the DRAFT prompt with DNA, findings, recalled playbook, and the layer CTA", async () => {
    const complete = fakeCompleteFor(1);
    const recallPlaybook = vi
      .fn()
      .mockResolvedValue(["hook: lead with a contrarian claim"]);

    await runGrowthGenerate({
      strategy: STRATEGY,
      findings: FINDINGS,
      funnelTargets: { tofu: 1, mofu: 0, bofu: 0 },
      complete,
      recallPlaybook,
      refine: false,
    });

    expect(recallPlaybook).toHaveBeenCalledTimes(1);
    const { user, system } = complete.mock.calls[0][0];
    expect(system).toContain("growth-marketing copywriter");
    expect(system).toContain("Hook–Body–CTA"); // structure is hard-enforced
    expect(system).toContain("FORBIDDEN"); // slop ban present
    expect(user).toContain("AI agent ownership"); // DNA / strategy
    expect(user).toContain("founders distrust black-box AI"); // finding
    expect(user).toContain("lead with a contrarian claim"); // recall
    expect(user).toContain("follow-or-save"); // TOFU's single CTA reaches the model
  });

  it("fails open when recall throws (still produces drafts)", async () => {
    const complete = fakeCompleteFor(1);
    const recallPlaybook = vi.fn().mockRejectedValue(new Error("hub down"));

    const out = await runGrowthGenerate({
      strategy: STRATEGY,
      funnelTargets: { tofu: 1, mofu: 0, bofu: 0 },
      complete,
      recallPlaybook,
    });

    expect(out).toHaveLength(1);
  });

  it("returns [] when the LLM emits no valid drafts", async () => {
    const complete = vi.fn().mockResolvedValue("garbage, not json");
    const out = await runGrowthGenerate({ strategy: STRATEGY, complete });
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CRITIQUE_THEN_REVISE: the named-rubric refine pass.
// ---------------------------------------------------------------------------

/** A bait-laden draft the editor must fix; the slop markers we must NOT see post-refine. */
const SLOP_DRAFT = JSON.stringify([
  {
    topic: "vibes",
    angle: "relatable chaos",
    text: "Ever had one of those days where everything seems like a scene from a sitcom? 😂 Let's laugh at the chaos together! Comment YES for the link 👇 and tag a friend!",
  },
]);

/** A clean, single-CTA rewrite the editor returns for that draft. */
const CLEAN_REVISION = JSON.stringify([
  {
    topic: "ownership",
    angle: "own your distribution",
    text: "Renting your audience on someone else's platform means one algorithm change can erase you.\nOwn the relationship: a list you control compounds while a feed you don't can vanish overnight.\nFollow for more on owning your distribution.",
  },
]);

/** Markers that, if present, mean the post is still slop. */
const BAIT_MARKERS = [
  "comment yes",
  "tag a friend",
  "let's laugh",
  "double-tap",
  "who else",
  "ever had one of those days",
];

function hasBait(text: string): boolean {
  const t = text.toLowerCase();
  return BAIT_MARKERS.some((m) => t.includes(m));
}

/** Count CTA-shaped lines (single-CTA assertion for the stub revision). */
function ctaLineCount(text: string): number {
  return text
    .split("\n")
    .filter((l) => /\b(follow|save|reply|subscribe|start|read|sign up|join)\b/i.test(l))
    .length;
}

describe("runGrowthGenerate - critique→revise refine pass", () => {
  /**
   * A deterministic two-call stub: the FIRST `complete` (draft pass) returns the slop
   * draft; the SECOND (refine pass) returns the clean, single-CTA rewrite. This lets us
   * assert the workflow actually critiques + revises (not just drafts).
   */
  function fakeDraftThenRefine() {
    return vi
      .fn()
      .mockResolvedValueOnce(SLOP_DRAFT) // draft pass emits slop
      .mockResolvedValueOnce(CLEAN_REVISION); // refine pass fixes it
  }

  it("runs a second LLM pass that critiques + rewrites the draft (bait stripped, one CTA, revision bumped)", async () => {
    const complete = fakeDraftThenRefine();

    const out = await runGrowthGenerate({
      strategy: STRATEGY,
      findings: FINDINGS,
      funnelTargets: { tofu: 1, mofu: 0, bofu: 0 },
      complete,
    });

    // Exactly TWO passes: draft + one bounded refine (never a loop).
    expect(complete).toHaveBeenCalledTimes(2);

    // The refine pass was given the named rubric + the draft to critique.
    const refineCall = complete.mock.calls[1][0];
    expect(refineCall.system).toContain("EDITOR");
    expect(refineCall.system).toContain("HOOK STRENGTH");
    expect(refineCall.system).toContain("NO-BAIT");
    expect(refineCall.user).toContain("Draft posts to critique and rewrite");
    expect(refineCall.user).toContain("scene from a sitcom"); // the slop draft text

    // The OUTPUT is the refined post: bait stripped, exactly one CTA, revision = 1.
    expect(out).toHaveLength(1);
    const post = out[0];
    expect(post.revision).toBe(1);
    expect(hasBait(post.text)).toBe(false);
    expect(ctaLineCount(post.text)).toBe(1);
    // It is NOT the original slop.
    expect(post.text).not.toContain("scene from a sitcom");
  });

  it("respects funnel targets across the refine pass (2 passes per non-empty layer)", async () => {
    // Each call returns 2 distinct posts regardless of draft/refine — so the refined
    // batch covers every draft (coverage guard satisfied) and counts hold.
    const complete = fakeCompleteFor(2);

    const out = await runGrowthGenerate({
      strategy: STRATEGY,
      findings: FINDINGS,
      funnelTargets: { tofu: 2, mofu: 2, bofu: 0 },
      complete,
    });

    const byLayer = (l: string) => out.filter((p) => p.funnelLayer === l).length;
    expect(byLayer("tofu")).toBe(2);
    expect(byLayer("mofu")).toBe(2);
    expect(byLayer("bofu")).toBe(0);
    // 2 non-empty layers × (1 draft + 1 refine) = 4 LLM calls.
    expect(complete).toHaveBeenCalledTimes(4);
    // Every surviving post went through refine → revision 1.
    expect(out.every((p) => p.revision === 1)).toBe(true);
  });

  it("fails open: a throwing refine pass keeps the draft batch (revision 0)", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([{ topic: "t", angle: "a", text: "a real draft body" }])
      )
      .mockRejectedValueOnce(new Error("refine LLM down"));

    const out = await runGrowthGenerate({
      strategy: STRATEGY,
      funnelTargets: { tofu: 1, mofu: 0, bofu: 0 },
      complete,
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1);
    expect(out[0].revision).toBe(0); // kept the draft — never threw, never dropped.
    expect(out[0].text).toBe("a real draft body");
  });

  it("keeps the draft batch when refine returns short/garbled coverage (no funnel shrink)", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          { topic: "a", angle: "a1", text: "draft one" },
          { topic: "b", angle: "b1", text: "draft two" },
        ])
      )
      // refine drops a row → coverage guard keeps the full draft batch.
      .mockResolvedValueOnce(
        JSON.stringify([{ topic: "a", angle: "a1", text: "only one came back" }])
      );

    const out = await runGrowthGenerate({
      strategy: STRATEGY,
      funnelTargets: { tofu: 2, mofu: 0, bofu: 0 },
      complete,
    });

    expect(out).toHaveLength(2); // funnel not shrunk
    expect(out.every((p) => p.revision === 0)).toBe(true); // kept drafts
    expect(out.map((p) => p.text)).toEqual(["draft one", "draft two"]);
  });
});

describe("parseDraftPosts - revision stamping", () => {
  it("stamps revision 0 by default and the given revision on refined rows", () => {
    const raw = JSON.stringify([{ topic: "x", angle: "y", text: "body" }]);
    expect(parseDraftPosts(raw, "tofu", 1)[0]?.revision).toBe(0);
    expect(parseDraftPosts(raw, "tofu", 1, 1)[0]?.revision).toBe(1);
  });
});
