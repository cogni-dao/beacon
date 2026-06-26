// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/growth/draft-card`
 * Purpose: Component-test the DRAFT REVIEW + REFINE card — the owner's #1 surface.
 *   Proves it renders the state badge + revision + score, and that each of the four
 *   actions (Approve, Reject, Edit→save, Refine→feedback) fires the correct
 *   account-scoped PATCH to the review-action route.
 * Scope: Renders `DraftCard` with a fake post + mocked `fetch`/`useRouter`. Does not
 *   exercise the real route, DB, or LLM (that is the component RLS lane).
 * Invariants:
 *   - STATE_BADGE_RENDERED: the post's status renders as a glanceable badge.
 *   - ACTIONS_FIRE_PATCH: approve/reject/edit/refine each PATCH .../posts/:id with
 *     the right action payload.
 *   - REFINE_CARRIES_FEEDBACK: the refine flow sends the human feedback note.
 * Side-effects: none (mocked fetch + router)
 * Links: app/src/app/(app)/growth/_components/DraftCard.tsx,
 *   app/src/app/(app)/growth/_api/mutateCampaign.ts
 * @internal
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CampaignPost } from "@/app/_facades/growth/campaigns.server";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { DraftCard } from "@/app/(app)/growth/_components/DraftCard";

const CAMPAIGN_ID = "demo-campaign";

function makePost(overrides: Partial<CampaignPost> = {}): CampaignPost {
  return {
    id: "post-1",
    channel: "moltbook",
    funnelLayer: "tofu",
    topic: "ownership",
    angle: "own your distribution",
    text: "Original draft text.",
    status: "generated",
    score: 0.82,
    revision: 1,
    externalPostId: null,
    postedAt: null,
    impressions: null,
    likes: 0,
    reposts: 0,
    replies: 0,
    capturedAt: null,
    ...overrides,
  };
}

/** Mock a successful PATCH returning the updated post shape. */
function mockPatchOk(body: Record<string, unknown>): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

/** The fetch call's [url, init] for the most recent invocation. */
function lastFetch(): [string, RequestInit] {
  const calls = vi.mocked(global.fetch).mock.calls;
  return calls[calls.length - 1] as unknown as [string, RequestInit];
}

describe("DraftCard - review + refine surface", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it("renders the state badge, revision, and score", () => {
    render(<DraftCard campaignId={CAMPAIGN_ID} post={makePost()} />);
    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(screen.getByText("rev 1")).toBeInTheDocument();
    expect(screen.getByText("score 82")).toBeInTheDocument();
    expect(screen.getByText("Original draft text.")).toBeInTheDocument();
  });

  it("renders an Approved badge for an approved draft", () => {
    render(
      <DraftCard campaignId={CAMPAIGN_ID} post={makePost({ status: "approved" })} />
    );
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("APPROVE fires PATCH action=approve", async () => {
    mockPatchOk({ id: "post-1", status: "approved", text: "x", revision: 1, score: null });
    render(<DraftCard campaignId={CAMPAIGN_ID} post={makePost()} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = lastFetch();
    expect(url).toBe(
      `/api/v1/growth/campaigns/${CAMPAIGN_ID}/posts/post-1`
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ action: "approve" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("REJECT fires PATCH action=reject", async () => {
    mockPatchOk({ id: "post-1", status: "rejected", text: "x", revision: 1, score: null });
    render(<DraftCard campaignId={CAMPAIGN_ID} post={makePost()} />);

    fireEvent.click(screen.getByRole("button", { name: /^reject/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, init] = lastFetch();
    expect(JSON.parse(init.body as string)).toEqual({ action: "reject" });
  });

  it("EDIT opens the inline editor and SAVE fires PATCH action=edit with new text", async () => {
    mockPatchOk({
      id: "post-1",
      status: "generated",
      text: "Edited text!",
      revision: 1,
      score: 0.82,
    });
    render(<DraftCard campaignId={CAMPAIGN_ID} post={makePost()} />);

    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    const textarea = screen.getByLabelText("Edit draft text");
    fireEvent.change(textarea, { target: { value: "Edited text!" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, init] = lastFetch();
    expect(JSON.parse(init.body as string)).toEqual({
      action: "edit",
      text: "Edited text!",
    });
  });

  it("REFINE opens the feedback note and fires PATCH action=refine with feedback", async () => {
    mockPatchOk({
      id: "post-1",
      status: "generated",
      text: "Refined text",
      revision: 2,
      score: null,
    });
    render(<DraftCard campaignId={CAMPAIGN_ID} post={makePost()} />);

    fireEvent.click(screen.getByRole("button", { name: /^refine$/i }));
    const note = screen.getByLabelText("Refine feedback note (optional)");
    fireEvent.change(note, { target: { value: "sharper hook" } });
    fireEvent.click(screen.getByRole("button", { name: /refine draft/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, init] = lastFetch();
    expect(JSON.parse(init.body as string)).toEqual({
      action: "refine",
      feedback: "sharper hook",
    });
  });

  it("REFINE without a note omits feedback", async () => {
    mockPatchOk({
      id: "post-1",
      status: "generated",
      text: "Refined text",
      revision: 2,
      score: null,
    });
    render(<DraftCard campaignId={CAMPAIGN_ID} post={makePost()} />);

    fireEvent.click(screen.getByRole("button", { name: /^refine$/i }));
    fireEvent.click(screen.getByRole("button", { name: /refine draft/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, init] = lastFetch();
    expect(JSON.parse(init.body as string)).toEqual({ action: "refine" });
  });

  it("surfaces a server error without crashing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    } as Response);
    render(<DraftCard campaignId={CAMPAIGN_ID} post={makePost()} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("boom")
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
