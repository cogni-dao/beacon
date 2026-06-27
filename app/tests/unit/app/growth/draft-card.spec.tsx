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
    moltbook: {
      submoltName: "general",
      title: "Original title",
      content: "Original draft text.",
      type: "text",
    },
    moltbookPayloadPersisted: true,
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

function renderCard(post: CampaignPost = makePost()) {
  return render(
    <DraftCard
      campaignId={CAMPAIGN_ID}
      post={post}
      moltbookConnection={{ handle: "@flock-leader", displayLabel: "flock-leader" }}
    />
  );
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
    renderCard();
    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(screen.getByText("rev 1")).toBeInTheDocument();
    expect(screen.getByText("score 82")).toBeInTheDocument();
    expect(screen.getAllByText("Original draft text.")).toHaveLength(1);
    expect(screen.queryByText("Final Moltbook payload")).not.toBeInTheDocument();
    expect(screen.queryByText("type: text")).not.toBeInTheDocument();
    expect(screen.getByText("m/general")).toBeInTheDocument();
    expect(screen.getByText("Original title")).toBeInTheDocument();
  });

  it("renders duplicate Moltbook payloads as a headline plus the full post", () => {
    const content =
      "Beacon should turn social publishing into a compounding review loop.";

    renderCard(
      makePost({
        text: content,
        moltbook: {
          submoltName: "general",
          title: content,
          content,
          type: "text",
        },
      })
    );

    expect(screen.getByText("own your distribution")).toBeInTheDocument();
    expect(screen.getByText(content)).toBeInTheDocument();
  });

  it("renders an Approved badge for an approved draft", () => {
    renderCard(makePost({ status: "approved" }));
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("APPROVE fires PATCH action=approve", async () => {
    mockPatchOk({
      id: "post-1",
      status: "approved",
      text: "x",
      moltbook: {
        submoltName: "general",
        title: "Original title",
        content: "Original draft text.",
        type: "text",
      },
      revision: 1,
      score: null,
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = lastFetch();
    expect(url).toBe(
      `/api/v1/growth/campaigns/${CAMPAIGN_ID}/posts/post-1`
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      action: "approve",
      moltbook: {
        submoltName: "general",
        title: "Original title",
        content: "Original draft text.",
        type: "text",
      },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("REJECT fires PATCH action=reject", async () => {
    mockPatchOk({
      id: "post-1",
      status: "rejected",
      text: "x",
      moltbook: null,
      revision: 1,
      score: null,
    });
    renderCard();

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
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    const textarea = screen.getByLabelText("Moltbook post body");
    fireEvent.change(textarea, { target: { value: "Edited text!" } });
    fireEvent.change(screen.getByLabelText("Moltbook headline"), {
      target: { value: "Edited title" },
    });
    fireEvent.change(screen.getByLabelText("Moltbook destination"), {
      target: { value: "ai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, init] = lastFetch();
    expect(JSON.parse(init.body as string)).toEqual({
      action: "edit",
      text: "Edited text!",
      moltbook: {
        submoltName: "ai",
        title: "Edited title",
        content: "Edited text!",
        type: "text",
      },
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
    renderCard();

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
    renderCard();

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
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("boom")
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("PUBLISH is separate from approve and posts an explicit postId", async () => {
    mockPatchOk({
      campaignId: CAMPAIGN_ID,
      postId: "post-1",
      considered: 1,
      published: 1,
      skippedNoConnection: 0,
      skippedNotEligible: 0,
      skippedMissingPayload: 0,
      failed: 0,
    });
    renderCard(makePost({ status: "approved" }));

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    expect(screen.getByText(/Publish to Moltbook/)).toBeInTheDocument();
    expect(screen.getByText(/@flock-leader/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = lastFetch();
    expect(url).toBe(`/api/v1/growth/campaigns/${CAMPAIGN_ID}/publish-approved`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ postId: "post-1" });
  });
});
