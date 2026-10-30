// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/work-item`
 * Purpose: Factory for WorkItemCapability — bridges ai-tools interface to WorkItemQueryPort + WorkItemCommandPort.
 * Scope: Creates WorkItemCapability that delegates to hexagonal ports. Does not implement transport.
 * Invariants:
 *   - PORTS_ARE_AUTHORITY: All operations delegate to WorkItemQueryPort/WorkItemCommandPort
 *   - TRANSITION_TABLE_ENFORCED: CommandPort validates transitions
 * Side-effects: none (factory only)
 * Links: docs/spec/development-lifecycle.md
 * @internal
 */

import { isPrivilegedPriority } from "@cogni/knowledge-store";
import type {
  WorkItemCapability,
  WorkItemInfo,
  WorkItemTransitionResult,
} from "@cogni/shared-ai-tools";
import { WorkItemPatchConflictError } from "@cogni/shared-ai-tools";
import type {
  ActorKind,
  WorkItemCommandPort,
  WorkItemQueryPort,
  WorkItemStatus,
  WorkItemType,
} from "@cogni/work-items";
import {
  isValidTransition,
  toWorkItemId,
  toWorkItemDto as toWorkItemInfo,
} from "@cogni/work-items";
import { InvalidTransitionError } from "@cogni/work-items/markdown";
import type { EvaluationWorkItemsPort } from "@/ports/work-items";

/**
 * Dependencies for creating the work item capability.
 */
export interface WorkItemCapabilityDeps {
  readonly workItemQuery: WorkItemQueryPort;
  readonly liveStore?: () => EvaluationWorkItemsPort;
  readonly getActorId?: () => string;
  readonly workItemCommand: WorkItemCommandPort;
  /**
   * QUERY_READS_THE_LIVE_BACKLOG: `query` lists through this when wired — the
   * node's Doltgres work items (the same read `GET /api/v1/work/items` uses).
   * The runtime image carries no `work/` tree, so a markdown-bound query always
   * saw an empty backlog. Writes are unchanged.
   */
  readonly backlogReader?: Pick<WorkItemQueryPort, "list">;
}

/**
 * Create a WorkItemCapability backed by hexagonal ports.
 */
export function createWorkItemCapability(
  deps: WorkItemCapabilityDeps,
): WorkItemCapability {
  const { workItemQuery, workItemCommand } = deps;

  const page: NonNullable<WorkItemCapability["queryPage"]> = async (params) => {
    const result = await (
      deps.liveStore?.() ??
      deps.backlogReader ??
      workItemQuery
    ).list({
      ...(params.sortBy && { sortBy: params.sortBy }),
      ...(params.sortDirection && { sortDirection: params.sortDirection }),
      ...(params.labels && { labels: [...params.labels] }),
      ...(params.labelPrefix && { labelPrefix: params.labelPrefix }),
      ...(params.scored !== undefined && { scored: params.scored }),
      ...(params.statuses && {
        statuses: params.statuses as readonly WorkItemStatus[],
      }),
      ...(params.types && { types: params.types as readonly WorkItemType[] }),
      ...(params.text && { text: params.text }),
      ...(params.actor && { actor: params.actor as ActorKind }),
      ...(params.projectId && { projectId: toWorkItemId(params.projectId) }),
      ...(params.limit && { limit: params.limit }),
      ...(params.cursor && { cursor: params.cursor }),
      ...(params.ids && { ids: params.ids.map(toWorkItemId) }),
    });
    return {
      items: result.items.map(toWorkItemInfo),
      ...(result.nextCursor && { nextCursor: result.nextCursor }),
    };
  };
  const actor = () => {
    const id = deps.getActorId?.();
    if (!id)
      throw new Error(
        "Work item writes require an authenticated execution actor",
      );
    return id;
  };
  return {
    queryPage: page,
    async query(params): Promise<readonly WorkItemInfo[]> {
      return (await page(params)).items;
    },

    async transitionStatus(input): Promise<WorkItemTransitionResult> {
      const current = await (deps.liveStore?.() ?? workItemQuery).get(
        toWorkItemId(input.id),
      );
      if (!current) {
        throw new Error(`Work item not found: ${input.id}`);
      }

      if (
        deps.liveStore &&
        !isValidTransition(current.status, input.toStatus as WorkItemStatus)
      ) {
        throw new InvalidTransitionError(
          current.id,
          current.status,
          input.toStatus as WorkItemStatus,
        );
      }

      const updated = deps.liveStore
        ? await deps.liveStore().patch(
            {
              id: current.id,
              expectedRevision: current.revision,
              set: { status: input.toStatus as WorkItemStatus },
            },
            actor(),
          )
        : await workItemCommand.transitionStatus({
            id: toWorkItemId(input.id),
            expectedRevision: String(current.revision),
            toStatus: input.toStatus as WorkItemStatus,
            ...(input.reason && { reason: input.reason }),
          });

      return {
        id: updated.id,
        previousStatus: current.status,
        newStatus: updated.status,
        revision: updated.revision as number,
      };
    },

    async patch(input): Promise<WorkItemInfo> {
      // P0P1_IS_NODE_ADMIN (story.5101): node admin is a wallet-bearing human
      // session (the container's `nodeAdmin`); a tool invocation carries no
      // wallet, so an AI patch to priority <= 1 is refused before any write.
      const priority = input.set.priority;
      if (priority != null && isPrivilegedPriority(priority)) {
        throw new Error(
          `authz_denied: priority ${priority} requires node admin — propose it instead`,
        );
      }
      const current = await (deps.liveStore?.() ?? workItemQuery).get(
        toWorkItemId(input.id),
      );
      if (!current) {
        throw new Error(`Work item not found: ${input.id}`);
      }

      try {
        const updated = deps.liveStore
          ? await deps.liveStore().patch(
              {
                id: current.id,
                ...(input.expectedRevision !== undefined && {
                  expectedRevision: input.expectedRevision,
                }),
                set: input.set,
              },
              actor(),
            )
          : await workItemCommand.patch({
              id: current.id,
              expectedRevision: String(current.revision),
              set: input.set,
            });
        return toWorkItemInfo(updated);
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "WorkItemRevisionConflictError"
        ) {
          const conflict = error as Error & {
            expectedRevision: number;
            currentRevision: number;
          };
          throw new WorkItemPatchConflictError(
            input.id,
            conflict.expectedRevision,
            conflict.currentRevision,
          );
        }
        throw error;
      }
    },
  };
}
