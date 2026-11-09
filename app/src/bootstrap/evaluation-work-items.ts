// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/**
 * Compose published content with unchanged v1 lease/DELETE behavior; no lease algorithm.
 *
 * BOUNDED_CLAIM_OVERLAY (task.0056): the legacy claim overlay applies only to the
 * full-item agent list and reads exactly the page's ids (limit = page length).
 * Summary pages and board columns (the /work and /dashboard read path) carry no
 * claim fields and never touch the legacy adapter.
 */

import type { WorkItemsDoltgresPort as LegacyWorkItemsPort } from "@cogni/legacy-work-items/adapters/doltgres";
import type { WorkItem, WorkItemsContentPort } from "@cogni/work-items";
import type { EvaluationWorkItemsPort } from "@/ports/work-items";

// Same failure reexported by the HTTP facade; no incomplete canonical row escapes.
export class WorkItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Work item not found: ${id}`);
    this.name = "WorkItemNotFoundError";
  }
}

type LeaseFields = Pick<WorkItem, "claimedByRun" | "claimedAt" | "lastCommand">;
type LegacyLeaseRow = NonNullable<
  Awaited<ReturnType<LegacyWorkItemsPort["get"]>>
>;

type LegacyLeasePort = Pick<
  LegacyWorkItemsPort,
  "get" | "list" | "claim" | "heartbeat" | "release" | "delete"
>;

export function composeEvaluationWorkItems(
  content: WorkItemsContentPort,
  legacy: LegacyLeasePort,
): EvaluationWorkItemsPort {
  const project = (item: WorkItem, lease: LeaseFields | null): WorkItem => {
    const {
      claimedByRun: _run,
      claimedAt: _at,
      lastCommand: _command,
      ...contentItem
    } = item;
    return {
      ...contentItem,
      ...(lease?.claimedByRun !== undefined && {
        claimedByRun: lease.claimedByRun,
      }),
      ...(lease?.claimedAt !== undefined && { claimedAt: lease.claimedAt }),
      ...(lease?.lastCommand !== undefined && {
        lastCommand: lease.lastCommand,
      }),
    };
  };
  const refresh = async (lease: LegacyLeaseRow): Promise<WorkItem> => {
    const current = await content.get(lease.id);
    if (!current) throw new WorkItemNotFoundError(lease.id);
    return project(current, lease);
  };
  const history = content.history?.bind(content);
  const listBoardColumns = content.listBoardColumns?.bind(content);
  return {
    async get(id) {
      const item = await content.get(id);
      return item ? project(item, await legacy.get(id)) : null;
    },
    async list(query) {
      const page = await content.list(query);
      if (!page.items.length) return page;
      // The content page owns membership, order, scores and revision; one keyed
      // read of this page's ids only.
      const ids = page.items.map((item) => item.id);
      const claims = await legacy.list({ ids, limit: ids.length });
      const byId = new Map(claims.items.map((item) => [item.id, item]));
      return {
        ...page,
        items: page.items.map((item) =>
          project(item, byId.get(item.id) ?? null),
        ),
      };
    },
    // Read options (signal, text deadline, scan cap) must reach the content adapter (task.0056).
    listSummaries: (query, options) => content.listSummaries(query, options),
    // Composed board read (one store read for every column) when the content
    // adapter provides it; otherwise the facade reads one column at a time.
    ...(listBoardColumns && { listBoardColumns }),
    ...(history && { history }),
    async create(input, principalId) {
      return content.create(input, principalId);
    },
    async patch(input, principalId) {
      const item = await content.patch(input, principalId);
      return project(item, await legacy.get(item.id));
    },
    delete: (id, principalId) => legacy.delete(id, principalId),
    async claim(input) {
      return refresh(await legacy.claim(input));
    },
    async heartbeat(input) {
      return refresh(await legacy.heartbeat(input));
    },
    async release(input) {
      return refresh(await legacy.release(input));
    },
  };
}
