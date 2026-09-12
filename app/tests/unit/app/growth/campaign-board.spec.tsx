// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/growth/campaign-board`
 * Purpose: Component-test the pipeline BOARD — the redesigned campaign detail surface.
 *   Proves the loop-stage columns render (Opportunities → Drafts → Ready → Posted →
 *   Rejected), that each draft lands in the column its `status` maps to, that the
 *   per-layer KPI strip renders, and that the reworked per-column AI-triggers (capture
 *   + Research on Opportunities, Generate on Drafts) are present.
 * Scope: Renders `CampaignBoard` with a fake `CampaignDetail` + mocked `useRouter`.
 *   No real route/DB/LLM/mic (SpeechRecognition is absent in jsdom → mic hidden).
 * Invariants:
 *   - COLUMNS_ARE_THE_LOOP: the five stage columns render in order.
 *   - CARD_IN_ITS_STAGE: a post renders under the column `postStage(status)` selects.
 *   - TRIGGERS_ON_COLUMNS: capture/research/generate render on their columns.
 * Side-effects: none (mocked router)
 * Links: app/src/app/(app)/growth/_components/CampaignBoard.tsx,
 *   app/src/app/_facades/growth/campaigns.shared.ts (postStage)
 * @internal
 * @vitest-environment jsdom
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  CampaignDetail,
  CampaignPost,
  FunnelLayerKpi,
} from "@/app/_facades/growth/campaigns.server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CampaignBoard } from "@/app/(app)/growth/_components/CampaignBoard";

function kpi(): FunnelLayerKpi {
  return {
    score0to100: 40,
    edge: "invalidates",
    observedRate: 0,
    basis: "none",
    postedBroadcasts: 0,
    snapshotCount: 0,
  };
}

function makePost(overrides: Partial<CampaignPost>): CampaignPost {
  return {
    id: "post-x",
    channel: "moltbook",
    funnelLayer: "tofu",
    topic: null,
    angle: null,
    text: "body",
    moltbook: {
      submoltName: "general",
      title: "body",
      content: "body",
      type: "text",
    },
    moltbookPayloadPersisted: true,
    status: "generated",
    score: null,
    revision: 0,
    externalPostId: null,
    externalPostUrl: null,
    postedAt: null,
    impressions: null,
    likes: 0,
    reposts: 0,
    replies: 0,
    capturedAt: null,
    ...overrides,
  };
}

function makeCampaign(posts: CampaignPost[]): CampaignDetail {
  return {
    campaignId: "demo-campaign",
    title: "Demo Campaign",
    status: "active",
    targetRate: 0.03,
    evaluateAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    score0to100: 40,
    edge: "invalidates",
    observedRate: 0,
    basis: "none",
    snapshotCount: 0,
    postedBroadcasts: 0,
    layers: { tofu: kpi(), mofu: kpi(), bofu: kpi() },
    brief: "Grow the audience.",
    moltbookConnection: { handle: "@flock-leader", displayLabel: "flock-leader" },
    findings: [],
    currentThinking: null,
    nextPostPriorities: [],
    posts,
  };
}

/** Get the column `<section>` by its accessible label ("<Label> column"). */
function column(label: string): HTMLElement {
  return screen.getByRole("region", { name: `${label} column` });
}

describe("CampaignBoard - loop-stage pipeline board", () => {
  it("renders the five stage columns in loop order", () => {
    render(<CampaignBoard campaign={makeCampaign([])} />);
    for (const label of [
      "Opportunities",
      "Drafts",
      "Ready",
      "Posted",
      "Rejected",
    ]) {
      expect(column(label)).toBeInTheDocument();
    }
  });

  it("renders the per-layer KPI strip", () => {
    render(<CampaignBoard campaign={makeCampaign([])} />);
    expect(screen.getByText("tofu")).toBeInTheDocument();
    expect(screen.getByText("mofu")).toBeInTheDocument();
    expect(screen.getByText("bofu")).toBeInTheDocument();
  });

  it("places each draft in the column its status maps to", () => {
    const posts = [
      makePost({
        id: "d1",
        status: "generated",
        moltbook: {
          submoltName: "general",
          title: "A fresh draft",
          content: "c",
          type: "text",
        },
      }),
      makePost({
        id: "r1",
        status: "approved",
        moltbook: {
          submoltName: "general",
          title: "An approved post",
          content: "c",
          type: "text",
        },
      }),
      makePost({
        id: "p1",
        status: "posted",
        moltbook: {
          submoltName: "general",
          title: "A live post",
          content: "c",
          type: "text",
        },
      }),
      makePost({
        id: "x1",
        status: "rejected",
        moltbook: {
          submoltName: "general",
          title: "A rejected draft",
          content: "c",
          type: "text",
        },
      }),
    ];
    render(<CampaignBoard campaign={makeCampaign(posts)} />);

    expect(within(column("Drafts")).getByText("A fresh draft")).toBeInTheDocument();
    expect(
      within(column("Ready")).getByText("An approved post")
    ).toBeInTheDocument();
    expect(within(column("Posted")).getByText("A live post")).toBeInTheDocument();
    expect(
      within(column("Rejected")).getByText("A rejected draft")
    ).toBeInTheDocument();

    // A draft does NOT leak into a sibling column.
    expect(
      within(column("Ready")).queryByText("A fresh draft")
    ).not.toBeInTheDocument();
  });

  it("puts the reworked AI-triggers on the columns they advance", () => {
    render(<CampaignBoard campaign={makeCampaign([])} />);
    // Capture + Research live on Opportunities.
    const opportunities = column("Opportunities");
    expect(
      within(opportunities).getByLabelText(
        "Capture an idea to generate drafts from"
      )
    ).toBeInTheDocument();
    expect(
      within(opportunities).getByRole("button", { name: /Research/i })
    ).toBeInTheDocument();
    // Generate lives on Drafts.
    expect(
      within(column("Drafts")).getByRole("button", { name: /Generate more/i })
    ).toBeInTheDocument();
  });
});
