// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Unit tests for XSocialAdapter.readAccountMetrics (the per-tenant live read).
 * Mocks twitter-api-v2 — no network. Verifies the v2 profile + timeline response
 * maps onto the Zod-shaped XAccountMetrics contract, including free-tier gaps.
 */

import { XAccountMetricsSchema } from "@cogni/ai-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { meMock, userTimelineMock } = vi.hoisted(() => ({
  meMock: vi.fn(),
  userTimelineMock: vi.fn(),
}));

vi.mock("twitter-api-v2", () => ({
  TwitterApi: class {
    v2 = { me: meMock, userTimeline: userTimelineMock };
  },
}));

import { XSocialAdapter } from "@/adapters/server/social/x.adapter";

describe("XSocialAdapter.readAccountMetrics", () => {
  beforeEach(() => {
    meMock.mockReset();
    userTimelineMock.mockReset();
  });

  it("maps the authenticated profile + recent post public_metrics", async () => {
    meMock.mockResolvedValue({
      data: {
        id: "42",
        username: "acme",
        name: "Acme Co",
        profile_image_url: "https://img.example/x.jpg",
        public_metrics: {
          followers_count: 1234,
          following_count: 56,
          tweet_count: 789,
        },
      },
    });
    userTimelineMock.mockResolvedValue({
      tweets: [
        {
          id: "t1",
          text: "hello world",
          created_at: "2026-01-01T00:00:00.000Z",
          public_metrics: {
            like_count: 10,
            retweet_count: 3,
            reply_count: 2,
            impression_count: 500,
          },
        },
      ],
    });

    const adapter = new XSocialAdapter({ accessToken: "user-token" });
    const result = await adapter.readAccountMetrics({ limit: 5 });

    // Contract-valid (Zod) shape.
    expect(() => XAccountMetricsSchema.parse(result)).not.toThrow();
    expect(result.profile).toEqual({
      externalAccountId: "42",
      handle: "@acme",
      displayName: "Acme Co",
      followers: 1234,
      following: 56,
      postCount: 789,
      avatarUrl: "https://img.example/x.jpg",
    });
    expect(result.recentPosts).toHaveLength(1);
    expect(result.recentPosts[0]).toMatchObject({
      externalId: "t1",
      text: "hello world",
      likes: 10,
      reposts: 3,
      replies: 2,
      impressions: 500,
    });
    // Profile read requested the public_metrics user.fields.
    expect(meMock).toHaveBeenCalledWith({
      "user.fields": ["public_metrics", "profile_image_url"],
    });
  });

  it("clamps the recent-post limit into X's 5–100 timeline window", async () => {
    meMock.mockResolvedValue({
      data: { id: "1", username: "u", name: "U", public_metrics: {} },
    });
    userTimelineMock.mockResolvedValue({ tweets: [] });

    const adapter = new XSocialAdapter({ accessToken: "t" });
    await adapter.readAccountMetrics({ limit: 1 });

    expect(userTimelineMock).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ max_results: 5 })
    );
  });

  it("omits impressions/following when X does not expose them", async () => {
    meMock.mockResolvedValue({
      data: {
        id: "1",
        username: "u",
        name: "U",
        public_metrics: { followers_count: 9 },
      },
    });
    userTimelineMock.mockResolvedValue({
      tweets: [
        {
          id: "t",
          text: "x",
          created_at: "2026-01-01T00:00:00.000Z",
          public_metrics: { like_count: 1, retweet_count: 0, reply_count: 0 },
        },
      ],
    });

    const adapter = new XSocialAdapter({ accessToken: "t" });
    const result = await adapter.readAccountMetrics();

    expect(result.recentPosts[0]).not.toHaveProperty("impressions");
    expect(result.profile).not.toHaveProperty("following");
    expect(result.profile.followers).toBe(9);
  });
});
