// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/work-item`
 * Purpose: Factory for WorkItemCapability — bridges ai-tools interface to WorkItemQueryPort + WorkItemCommandPort.
 * Scope: Creates WorkItemCapability that delegates to hexagonal ports. Does not implement transport.
 * Invariants:
 *   - PORTS_ARE_AUTHORITY: All operations delegate to WorkItemQueryPort/WorkItemCommandPort
 *   - TRANSITION_TABLE_ENFORCED: CommandPort validates transitions
 *   - PATCH_REASON_AND_CITES (task.0086): the required `reason` and the optional `cites` are forwarded to the Doltgres store, the one enforcer;
 *     the markdown fallback (development only) has no history and ignores both, though the tool schema still requires a reason.
 *   - MOVES_READ_AT_READ_TIME (story.0033): a read that returns exactly one item adds each move's baseline,
 *     current reading and verdict from `moveReadings`; a list read returns the stored moves only, so a page costs no metric lookup.
 *   - ONE_ITEM_ENVELOPE (task.0118): `read` is the single-item envelope: it also adds each move's metric, KPI and goal (`moveReadings.context`) and, on request, the first page of citation links (`links`); both through the package's `composeItemEnvelope`; `query` and `queryPage` never do.
 * Side-effects: none (factory only)
 * Links: https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/development-lifecycle.md
 * @internal
 */

import type { WorkItemCapability, WorkItemInfo } from "@cogni/ai-tools";
import { WorkItemPatchConflictError } from "@cogni/ai-tools";
import { isPrivilegedPriority } from "@cogni/knowledge-store";
import type {
  ActorKind,
  createWorkItemWriters,
  EnvelopeDegradedEvent,
  ItemLinksPort,
  MoveReadingPort,
  WorkItemArtifactDeps,
  WorkItemCommandPort,
  WorkItemQueryPort,
  WorkItemSortBy,
  WorkItemStatus,
  WorkItemType,
} from "@cogni/work-items";
import {
  artifactsNotConfigured,
  composeItemEnvelope,
  createItemRefPorts,
  judgeMoveSummaries,
  recordWorkItemArtifact,
  toWorkItemId,
  toWorkItemDto as toWorkItemInfo,
  toWorkItemsPatchInput,
  WORK_ITEM_SORT_FIELDS,
} from "@cogni/work-items";
import { WorkItemRevisionConflictError } from "@cogni/work-items/adapters/doltgres";
import { getExecutionScope } from "@/adapters/server/ai/execution-scope";
import type { EvaluationWorkItemsPort } from "@/ports/work-items";

/**
 * Dependencies for creating the work item capability.
 */
export interface WorkItemCapabilityDeps {
  readonly workItemQuery: WorkItemQueryPort;
  readonly liveStore?: () => EvaluationWorkItemsPort;
  readonly writers: ReturnType<typeof createWorkItemWriters>;
  readonly artifactDeps: () => WorkItemArtifactDeps | undefined;
  readonly workItemCommand: WorkItemCommandPort;
  /**
   * QUERY_READS_THE_LIVE_BACKLOG: `query` lists through this when wired — the
   * node's Doltgres work items (the same read `GET /api/v1/work/items` uses).
   * The runtime image carries no `work/` tree, so a markdown-bound query always
   * saw an empty backlog. Writes are unchanged.
   */
  readonly backlogReader?: Pick<WorkItemQueryPort, "list">;
  /** Reads the metrics a single item moves; absent means no metrics service (every move reads `unknown`). */
  readonly moveReadings?: MoveReadingPort | undefined;
  /** First page of an item's citation links (`read` with `includeLinks`); absent reads `unavailable`. */
  readonly links?: ItemLinksPort | undefined;
  /** One event per degraded envelope part (chain or links). */
  readonly log?: ((event: EnvelopeDegradedEvent) => void) | undefined;
}

/** The patch `set` without explicit-undefined keys (the route facade drops them the same way). */
function isStoreSortBy(value: string): value is WorkItemSortBy {
  return (WORK_ITEM_SORT_FIELDS as readonly string[]).includes(value);
}

/**
 * Create a WorkItemCapability backed by hexagonal ports.
 */
export function createWorkItemCapability(
  deps: WorkItemCapabilityDeps,
): WorkItemCapability {
  const { workItemQuery } = deps;

  const page: NonNullable<WorkItemCapability["queryPage"]> = async (params) => {
    const result = await (
      deps.liveStore?.() ??
      deps.backlogReader ??
      workItemQuery
    ).list({
      // The published tool contract offers more sort keys than this store orders by.
      ...(params.sortBy &&
        isStoreSortBy(params.sortBy) && { sortBy: params.sortBy }),
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
  /** A one-item read gets each move judged from its observations (bounded: at most 3 moves). */
  async function withMoveReadings(
    items: readonly WorkItemInfo[],
  ): Promise<readonly WorkItemInfo[]> {
    const only = items.length === 1 ? items[0] : undefined;
    if (!only?.moves?.length) return items;
    return judgeMoveSummaries([only], deps.moveReadings);
  }

  return {
    queryPage: page,
    async query(params): Promise<readonly WorkItemInfo[]> {
      return withMoveReadings((await page(params)).items);
    },

    /**
     * THE single-item envelope (task.0118), the same shape `GET /api/v1/work/items/{id}` serves: the
     * item with each move's readings, verdict and metric → KPI → goal chain, and with `includeLinks`
     * the first page of citation links.
     */
    async read(id, options) {
      const item = (await page({ ids: [id], limit: 1 })).items.find(
        (entry) => entry.id === id,
      );
      if (!item) return null;
      // ONE_COMPOSITION: the same `composeItemEnvelope` the HTTP facade calls.
      return composeItemEnvelope(
        item,
        {
          readings: deps.moveReadings,
          links: deps.links,
          log: deps.log,
          artifacts: deps.artifactDeps()?.artifacts,
          ...createItemRefPorts({
            artifacts: deps.artifactDeps()?.artifacts,
            history: deps.liveStore?.(),
          }),
        },
        options,
      );
    },

    async recordArtifact(input) {
      const attribution = deps.writers.artifacts.attribution();
      const stores = deps.writers.artifacts.deps();
      const result = stores
        ? await recordWorkItemArtifact(
            stores,
            input.id,
            attribution,
            input.body,
          )
        : artifactsNotConfigured(input.id, "write");
      deps.writers.artifacts.log(result.log, attribution);
      return { status: result.status, body: result.body };
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

      if (getExecutionScope().graphId === "langgraph:operating-review") {
        const allowed = new Set(["status", "priority", "labels", "summary"]);
        if (Object.keys(input.set).some((field) => !allowed.has(field))) {
          throw new Error(
            "policy_denied: Operating Review may only update planning fields",
          );
        }
        if (
          input.set.status !== undefined &&
          current.status !== "needs_triage"
        ) {
          throw new Error(
            "policy_denied: Operating Review may only triage status",
          );
        }
      }
      try {
        const updated = await deps.writers.backlogWriter.store.patch(
          toWorkItemsPatchInput({
            id: current.id,
            expectedRevision: input.expectedRevision,
            reason: input.reason,
            cites: input.cites,
            set: input.set,
          }),
          deps.writers.backlogWriter.attribution(),
        );
        return toWorkItemInfo(updated);
      } catch (error) {
        if (error instanceof WorkItemRevisionConflictError) {
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
