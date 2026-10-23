// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Compose published content with unchanged v1 lease/DELETE behavior; no lease algorithm. */

import type { WorkItemsDoltgresPort as LegacyWorkItemsPort } from "@cogni/legacy-work-items/adapters/doltgres";
import type { WorkItem, WorkItemsContentPort } from "@cogni/work-items";
import type { EvaluationWorkItemsPort } from "@/ports/work-items";

type LegacyLeasePort = Pick<
  LegacyWorkItemsPort,
  "get" | "list" | "claim" | "heartbeat" | "release" | "delete"
>;

export function composeEvaluationWorkItems(
  content: WorkItemsContentPort,
  legacy: LegacyLeasePort,
): EvaluationWorkItemsPort {
  const project = (item: WorkItem, lease: WorkItem | null): WorkItem => {
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
  const refresh = async (item: WorkItem): Promise<WorkItem> =>
    project((await content.get(item.id)) ?? item, item);
  return {
    async get(id) {
      const item = await content.get(id);
      return item ? project(item, await legacy.get(id)) : null;
    },
    async list(query) {
      const page = await content.list(query);
      if (!page.items.length) return page;
      // The content page owns membership, order, scores and revision.
      const claims = await legacy.list({
        ids: page.items.map((item) => item.id),
        limit: 500,
      });
      const byId = new Map(claims.items.map((item) => [item.id, item]));
      return {
        ...page,
        items: page.items.map((item) =>
          project(item, byId.get(item.id) ?? null),
        ),
      };
    },
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
