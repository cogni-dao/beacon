// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/langgraph-graphs/growth-refine-single`
 * Purpose: Unit-test the single-draft REFINE helper (`refineSingleDraft`) that backs
 *   the human Refine action — prove it critiques→rewrites ONE draft via the SAME
 *   injected `complete` seam the generate route's gated facade backs, injects a human
 *   feedback note when given, reuses the shared `parseDraftPosts` parser, and FAILS
 *   SAFE (returns null, never throws) so the route can keep the original.
 * Scope: Pure workflow with an injected fake `complete` (no LLM, no DB, no network).
 *   Does NOT exercise the HTTP route, persistence, or billing — that is the component
 *   route lane; the billing fence is the stack ALLOWLIST test.
 * Invariants:
 *   - SINGLE_COMPLETE_CALL: exactly one `complete()` per refine (no loop).
 *   - HUMAN_FEEDBACK_IS_LAW: a feedback note reaches the model's user message.
 *   - PARSE_TOLERANT_FAIL_SAFE: non-JSON / empty output → null, never throws.
 *   - REVISION_STAMPED: a successful rewrite carries revision 1 (caller bumps the row).
 * Side-effects: none
 * Links: packages/langgraph-graphs/src/graphs/growth-generate/workflow.ts
 * @internal
 */

import {
  type CampaignStrategy,
  refineSingleDraft,
  type SingleDraftToRefine,
} from "@cogni/langgraph-graphs";
import { describe, expect, it, vi } from "vitest";

const STRATEGY: CampaignStrategy = {
  campaignId: "demo",
  voice: "punchy and direct",
  coreTopic: "AI agent ownership",
  icp: "indie SaaS founders",
  objective: "signups",
};

const DRAFT: SingleDraftToRefine = {
  funnelLayer: "tofu",
  topic: "ownership",
  angle: "own your distribution",
  text: "Original draft body.\nFollow for more.",
};

/** A fake `complete` returning one rewritten post; records the prompts it saw. */
function fakeComplete(text = "Rewritten, sharper draft.\nFollow for more.") {
  return vi.fn().mockImplementation(async () =>
    JSON.stringify([{ topic: "ownership", angle: "own it", text }])
  );
}

describe("refineSingleDraft - the human Refine action", () => {
  it("rewrites the draft via exactly one complete() call, stamped revision 1", async () => {
    const complete = fakeComplete();
    const out = await refineSingleDraft({ strategy: STRATEGY, draft: DRAFT, complete });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
    expect(out?.text).toContain("Rewritten");
    expect(out?.revision).toBe(1);
    expect(out?.funnelLayer).toBe("tofu");
  });

  it("injects the human feedback note into the model's user message", async () => {
    const complete = fakeComplete();
    await refineSingleDraft({
      strategy: STRATEGY,
      draft: DRAFT,
      feedback: "make the hook way sharper, drop the jargon",
      complete,
    });

    const arg = complete.mock.calls[0]?.[0] as { system: string; user: string };
    expect(arg.user).toContain("HUMAN FEEDBACK");
    expect(arg.user).toContain("make the hook way sharper");
    // The original draft text is handed to the editor to rewrite.
    expect(arg.user).toContain("Original draft body.");
  });

  it("does NOT add a feedback block when no note is given", async () => {
    const complete = fakeComplete();
    await refineSingleDraft({ strategy: STRATEGY, draft: DRAFT, complete });
    const arg = complete.mock.calls[0]?.[0] as { user: string };
    expect(arg.user).not.toContain("HUMAN FEEDBACK");
  });

  it("FAILS SAFE to null when the model returns non-JSON", async () => {
    const complete = vi.fn().mockResolvedValue("sorry, I cannot do that");
    const out = await refineSingleDraft({ strategy: STRATEGY, draft: DRAFT, complete });
    expect(out).toBeNull();
  });

  it("FAILS SAFE to null (never throws) when complete() throws", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("LLM down"));
    const out = await refineSingleDraft({ strategy: STRATEGY, draft: DRAFT, complete });
    expect(out).toBeNull();
  });

  it("recall failure fails open — still produces a revision", async () => {
    const complete = fakeComplete();
    const recallPlaybook = vi.fn().mockRejectedValue(new Error("hub down"));
    const out = await refineSingleDraft({
      strategy: STRATEGY,
      draft: DRAFT,
      complete,
      recallPlaybook,
    });
    expect(out).not.toBeNull();
    expect(out?.text).toContain("Rewritten");
  });
});
