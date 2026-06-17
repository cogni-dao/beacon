// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_api/mutateCampaign`
 * Purpose: Client-side fetch wrappers for the growth campaign CRUD endpoints —
 *   create (POST), status toggle (PATCH), and delete (DELETE). Cookie-session only.
 * Scope: Thin `fetch` wrappers + error normalization. No UI state, no cache wiring
 *   (callers refresh via `router.refresh()`).
 * Side-effects: IO (HTTP to /api/v1/growth/campaigns[/:campaignId]).
 * Links: app/src/app/api/v1/growth/campaigns/route.ts + [campaignId]/route.ts
 * @internal
 */

/** Owned campaign lifecycle status (mirrors the API/CHECK constraint). */
export type CampaignStatus = "draft" | "active" | "paused" | "done";

export interface CreateCampaignInput {
  campaignId: string;
  title: string;
  brief: string;
  targetRate: number;
  evaluateAt: string;
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
