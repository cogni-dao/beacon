// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/_api/fetchWorkItems`
 * Purpose: Client-side fetch wrapper for work items list.
 * Scope: Calls /api/v1/work/items with type-safe contract. Does not implement business logic.
 * Invariants: Returns typed WorkItemsListOutput or throws
 * Side-effects: IO
 * Links: [work.items.list.v1.contract](../../../../contracts/work.items.list.v1.contract.ts)
 * @internal
 */

import type { WorkItemDto, WorkItemsListOutput } from "@cogni/node-contracts";

export class WorkItemFetchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkItemFetchError";
    this.status = status;
  }
}

export function isWorkItemNotFoundError(
  error: unknown
): error is WorkItemFetchError {
  return error instanceof WorkItemFetchError && error.status === 404;
}

async function responseErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return fallback;
}

export async function fetchWorkItems(): Promise<WorkItemsListOutput> {
  const items = new Map<string, WorkItemDto>();
  const visited = new Set<string>();
  let cursor: string | undefined;
  // Fail explicitly rather than render a truncated global ranking.
  for (let page = 0; page < 1000; page++) {
    const query = new URLSearchParams({ limit: "500" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/v1/work/items?${query}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await responseErrorMessage(response, `HTTP ${response.status}`));
    }
    const result = await response.json() as WorkItemsListOutput;
    for (const item of result.items) items.set(item.id, item);
    const next = result.pageInfo?.endCursor ?? result.nextCursor;
    const hasMore = result.pageInfo?.hasMore ?? Boolean(next);
    if (!hasMore) return { items: [...items.values()], pageInfo: { endCursor: null, hasMore: false } };
    if (!next || visited.has(next)) throw new Error("Work item pagination did not advance; complete ranking is unavailable");
    visited.add(next);
    cursor = next;
  }
  throw new Error("Work item pagination exceeded its safety bound; complete ranking is unavailable");
}

export async function fetchWorkItem(id: string): Promise<WorkItemDto> {
  const response = await fetch(`/api/v1/work/items/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const message = await responseErrorMessage(
      response,
      `Failed to fetch work item (HTTP ${response.status})`
    );
    throw new WorkItemFetchError(message, response.status);
  }
  return response.json() as Promise<WorkItemDto>;
}
