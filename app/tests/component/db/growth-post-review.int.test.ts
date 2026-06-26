// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/db/growth-post-review`
 * Purpose: Prove the DRAFT REVIEW + REFINE route (PATCH
 *   .../campaigns/:id/posts/:postId) against a REAL Postgres: the state transitions
 *   (approve→approved, reject→rejected, edit→new text), the RLS account-scoping (a
 *   user cannot review another account's draft → 404, no existence leak), and that
 *   Refine bumps `revision` and resets status to 'generated' — with the gated facade
 *   mocked so the lane stays DB-only (the billing fence itself is the stack ALLOWLIST
 *   test; here we assert the route persists the refined revision).
 * Scope: Calls the real route handler with a mocked session + mocked `chatCompletion`
 *   facade against a testcontainers Postgres. Does not hit Temporal/Redis/an LLM.
 * Invariants:
 *   - STATE_TRANSITIONS: approve/reject/edit persist the documented status/text.
 *   - RLS_ACCOUNT_SCOPED: account B cannot touch account A's post (404).
 *   - REFINE_BUMPS_REVISION: a successful refine sets revision = prior+1, status
 *     'generated', and replaces the text with the model's rewrite.
 *   - REFINE_THROUGH_FACADE: the route reaches the draft via `chatCompletion` (mocked),
 *     never a raw LlmService.
 * Side-effects: IO (database operations via testcontainers).
 * Links: app/src/app/api/v1/growth/campaigns/[campaignId]/posts/[postId]/route.ts,
 *   app/src/app/_facades/ai/completion.server.ts
 * @public
 */

import { randomUUID } from "node:crypto";
import type { SessionUser } from "@cogni/node-shared";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingAccounts,
  campaigns,
  posts,
  users,
} from "@/shared/db/schema";

// Mock session auth (route reads getSessionUser).
vi.mock("@/app/_lib/auth/session", () => ({ getSessionUser: vi.fn() }));
// Mock the gated AI facade so refine doesn't touch Temporal/Redis/LLM; the billing
// fence is enforced by the stack ALLOWLIST test, not here.
vi.mock("@/app/_facades/ai/completion.server", () => ({
  chatCompletion: vi.fn(),
}));

import { getSessionUser } from "@/app/_lib/auth/session";
import { chatCompletion } from "@/app/_facades/ai/completion.server";
import { PATCH } from "@/app/api/v1/growth/campaigns/[campaignId]/posts/[postId]/route";

const CAMPAIGN_A = "review-test-a";
const CAMPAIGN_B = "review-test-b";

interface Acct {
  userId: string;
  accountId: string;
  sessionUser: SessionUser;
}

function makeAcct(tag: string): Acct {
  const userId = randomUUID();
  return {
    userId,
    accountId: randomUUID(),
    sessionUser: {
      id: userId,
      walletAddress: `0x${tag.repeat(40)}`.slice(0, 42),
      displayName: null,
      avatarColor: null,
    },
  };
}

/** Insert a fresh draft for an account; returns its id. */
async function seedDraft(
  acct: Acct,
  campaignId: string,
  overrides: Partial<typeof posts.$inferInsert> = {}
): Promise<string> {
  const id = randomUUID();
  await getSeedDb()
    .insert(posts)
    .values({
      id,
      accountId: acct.accountId,
      campaignId,
      ideaKey: randomUUID(),
      channel: "moltbook",
      funnelLayer: "tofu",
      topic: "ownership",
      angle: "own your distribution",
      text: "Original draft body.\nFollow for more.",
      status: "generated",
      revision: 0,
      ...overrides,
    });
  return id;
}

function patchReq(
  campaignId: string,
  postId: string,
  body: unknown
): [NextRequest, { params: Promise<{ campaignId: string; postId: string }> }] {
  const req = new NextRequest(
    `http://localhost/api/v1/growth/campaigns/${campaignId}/posts/${postId}`,
    { method: "PATCH", body: JSON.stringify(body) }
  );
  return [req, { params: Promise.resolve({ campaignId, postId }) }];
}

describe("growth draft review + refine route (RLS + state transitions)", () => {
  const a = makeAcct("a");
  const b = makeAcct("b");

  beforeAll(async () => {
    const seedDb = getSeedDb();
    for (const [acct, campaignId] of [
      [a, CAMPAIGN_A],
      [b, CAMPAIGN_B],
    ] as const) {
      await seedDb.insert(users).values({
        id: acct.userId,
        name: `User ${acct.userId.slice(0, 4)}`,
        walletAddress: acct.sessionUser.walletAddress ?? null,
      });
      await seedDb.insert(billingAccounts).values({
        id: acct.accountId,
        ownerUserId: acct.userId,
        balanceCredits: 1000n,
      });
      await seedDb.insert(campaigns).values({
        accountId: acct.accountId,
        campaignId,
        title: `Campaign ${campaignId}`,
        status: "draft",
        coreTopic: "AI agent ownership",
        voice: "punchy",
        icp: "indie founders",
        objective: "signups",
      });
    }
  });

  afterAll(async () => {
    const seedDb = getSeedDb();
    const ids = [a.accountId, b.accountId];
    await seedDb.delete(posts).where(sql`account_id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(campaigns)
      .where(sql`account_id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(billingAccounts)
      .where(sql`id IN (${ids[0]}, ${ids[1]})`);
    await seedDb.delete(users).where(sql`id IN (${a.userId}, ${b.userId})`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("APPROVE transitions status to 'approved'", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(a.sessionUser);
    const postId = await seedDraft(a, CAMPAIGN_A);

    const res = await PATCH(...patchReq(CAMPAIGN_A, postId, { action: "approve" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("approved");

    const row = (
      await getSeedDb().select().from(posts).where(eq(posts.id, postId))
    )[0];
    expect(row?.status).toBe("approved");
  });

  it("REJECT transitions status to 'rejected'", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(a.sessionUser);
    const postId = await seedDraft(a, CAMPAIGN_A);

    const res = await PATCH(...patchReq(CAMPAIGN_A, postId, { action: "reject" }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("rejected");
  });

  it("EDIT persists the new text, status unchanged", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(a.sessionUser);
    const postId = await seedDraft(a, CAMPAIGN_A);

    const res = await PATCH(
      ...patchReq(CAMPAIGN_A, postId, { action: "edit", text: "Human-edited body." })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Human-edited body.");
    expect(body.status).toBe("generated");
  });

  it("REJECTS empty edit text (Zod 400)", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(a.sessionUser);
    const postId = await seedDraft(a, CAMPAIGN_A);
    const res = await PATCH(
      ...patchReq(CAMPAIGN_A, postId, { action: "edit", text: "   " })
    );
    expect(res.status).toBe(400);
  });

  it("RLS: account B cannot review account A's draft (404)", async () => {
    // Seed a draft owned by A, but act as B.
    vi.mocked(getSessionUser).mockResolvedValue(a.sessionUser);
    const aPostId = await seedDraft(a, CAMPAIGN_A);

    vi.mocked(getSessionUser).mockResolvedValue(b.sessionUser);
    const res = await PATCH(
      ...patchReq(CAMPAIGN_A, aPostId, { action: "approve" })
    );
    expect(res.status).toBe(404);

    // A's row is untouched.
    const row = (
      await getSeedDb().select().from(posts).where(eq(posts.id, aPostId))
    )[0];
    expect(row?.status).toBe("generated");
  });

  it("401 without a session", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const res = await PATCH(
      ...patchReq(CAMPAIGN_A, randomUUID(), { action: "approve" })
    );
    expect(res.status).toBe(401);
  });

  it("REFINE bumps revision, resets to 'generated', and replaces text (facade mocked)", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(a.sessionUser);
    // The gated facade returns one rewritten post (OpenAI ChatCompletion shape).
    vi.mocked(chatCompletion).mockResolvedValue({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "gpt-4o-mini",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify([
              { topic: "ownership", angle: "own it", text: "Refined, sharper draft.\nFollow for more." },
            ]),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);

    const postId = await seedDraft(a, CAMPAIGN_A, { revision: 2 });

    const res = await PATCH(
      ...patchReq(CAMPAIGN_A, postId, { action: "refine", feedback: "sharper hook" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision).toBe(3);
    expect(body.status).toBe("generated");
    expect(body.text).toContain("Refined");
    expect(chatCompletion).toHaveBeenCalledTimes(1);

    const row = (
      await getSeedDb().select().from(posts).where(eq(posts.id, postId))
    )[0];
    expect(row?.revision).toBe(3);
    expect(row?.text).toContain("Refined");
  });

  it("REFINE keeps the original draft when the model yields no usable rewrite (502)", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(a.sessionUser);
    vi.mocked(chatCompletion).mockResolvedValue({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "gpt-4o-mini",
      choices: [
        { index: 0, message: { role: "assistant", content: "not json" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);

    const postId = await seedDraft(a, CAMPAIGN_A, { revision: 1 });
    const res = await PATCH(
      ...patchReq(CAMPAIGN_A, postId, { action: "refine" })
    );
    expect(res.status).toBe(502);

    const row = (
      await getSeedDb().select().from(posts).where(eq(posts.id, postId))
    )[0];
    expect(row?.revision).toBe(1); // unchanged
    expect(row?.text).toContain("Original draft body.");
  });
});
