// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_api/mutateCampaign`
 * Purpose: Client-side fetch wrappers for the growth campaign endpoints — create
 *   (POST), status toggle (PATCH), delete (DELETE), and the on-demand loop
 *   activities research + generate (POST). Cookie-session only.
 * Scope: Thin `fetch` wrappers + error normalization. No UI state, no cache wiring
 *   (callers refresh via `router.refresh()`).
 * Side-effects: IO (HTTP to /api/v1/growth/campaigns[/:campaignId][/research|/generate]).
 * Links: app/src/app/api/v1/growth/campaigns/route.ts + [campaignId]/route.ts
 *   + [campaignId]/research/route.ts + [campaignId]/generate/route.ts
 * @internal
 */

/** Owned campaign lifecycle status (mirrors the API/CHECK constraint). */
export type CampaignStatus = "draft" | "active" | "paused" | "done";

export interface CreateCampaignInput {
  campaignId: string;
  title: string;
  /**
   * The campaign's DEFINE DNA — voice + topic + audience + objective. This is
   * what the AI reads on every research/generate run; the KPI mechanics
   * (target rate, evaluate-by) are defaulted server-side, not collected here.
   */
  coreTopic: string;
  voice: string;
  icp: string;
  objective: string;
}

export interface CreateCampaignResponse {
  campaignId: string;
  status: CampaignStatus;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error || `HTTP ${response.status}` || fallback;
}

export async function createCampaign(
  input: CreateCampaignInput
): Promise<CreateCampaignResponse> {
  const response = await fetch("/api/v1/growth/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create campaign"));
  }
  return response.json() as Promise<CreateCampaignResponse>;
}

export async function setCampaignStatus(
  campaignId: string,
  status: CampaignStatus
): Promise<void> {
  const response = await fetch(
    `/api/v1/growth/campaigns/${encodeURIComponent(campaignId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ status }),
    }
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update status"));
  }
}

export async function deleteCampaign(campaignId: string): Promise<void> {
  const response = await fetch(
    `/api/v1/growth/campaigns/${encodeURIComponent(campaignId)}`,
    { method: "DELETE", credentials: "same-origin", cache: "no-store" }
  );
  if (!response.ok && response.status !== 204) {
    throw new Error(await readError(response, "Failed to delete campaign"));
  }
}

async function runActivity(
  campaignId: string,
  activity: "research" | "generate",
  resultKey: "findings" | "posts",
  fallback: string
): Promise<number> {
  const response = await fetch(
    `/api/v1/growth/campaigns/${encodeURIComponent(campaignId)}/${activity}`,
    { method: "POST", credentials: "same-origin", cache: "no-store" }
  );
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  const body = (await response.json().catch(() => ({}))) as {
    findings?: unknown[];
    posts?: unknown[];
  };
  return body[resultKey]?.length ?? 0;
}

/** Run the RESEARCH activity; returns how many findings it produced. */
export async function runResearch(campaignId: string): Promise<number> {
  return runActivity(campaignId, "research", "findings", "Research failed");
}

/** Run the GENERATE activity; returns how many post drafts it produced. */
export async function generatePosts(campaignId: string): Promise<number> {
  return runActivity(campaignId, "generate", "posts", "Generate failed");
}

// ---------------------------------------------------------------------------
// Per-draft REVIEW + REFINE actions (PATCH .../posts/:postId)
// ---------------------------------------------------------------------------

/** Post review lifecycle status (mirrors the API/CHECK constraint). */
export type PostStatus =
  | "generated"
  | "refining"
  | "in_review"
  | "approved"
  | "posted"
  | "rejected"
  | "failed";

/** The updated draft fields a review action returns. */
export interface ReviewedPost {
  id: string;
  status: PostStatus;
  text: string;
  revision: number;
  score: number | null;
}

async function patchPost(
  campaignId: string,
  postId: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<ReviewedPost> {
  const response = await fetch(
    `/api/v1/growth/campaigns/${encodeURIComponent(campaignId)}/posts/${encodeURIComponent(postId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return response.json() as Promise<ReviewedPost>;
}

/** APPROVE a draft → status 'approved'. */
export async function approvePost(
  campaignId: string,
  postId: string
): Promise<ReviewedPost> {
  return patchPost(campaignId, postId, { action: "approve" }, "Approve failed");
}

/** REJECT a draft → status 'rejected'. */
export async function rejectPost(
  campaignId: string,
  postId: string
): Promise<ReviewedPost> {
  return patchPost(campaignId, postId, { action: "reject" }, "Reject failed");
}

/** EDIT a draft's text in place (status unchanged). */
export async function editPost(
  campaignId: string,
  postId: string,
  text: string
): Promise<ReviewedPost> {
  return patchPost(campaignId, postId, { action: "edit", text }, "Edit failed");
}

/**
 * REFINE a draft → regenerate it through the gated facade into a NEW revision,
 * optionally steered by a human feedback note. Bumps `revision`.
 */
export async function refinePost(
  campaignId: string,
  postId: string,
  feedback?: string
): Promise<ReviewedPost> {
  return patchPost(
    campaignId,
    postId,
    { action: "refine", ...(feedback?.trim() ? { feedback: feedback.trim() } : {}) },
    "Refine failed"
  );
}
