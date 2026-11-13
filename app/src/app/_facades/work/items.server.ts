// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/work/items.server`
 * Purpose: Server-side facade for work item read/write operations across the markdown + Doltgres surfaces.
 * Scope: Maps port results to contract DTOs. Exactly one backend owns each list order and cursor: node-local Doltgres, or legacy markdown only when Doltgres is not configured.
 * Invariants: P0P1_IS_NODE_ADMIN (story.5101: priority <= 1 on create/patch requires node admin,
 *   checked before the store write), PORT_VIA_CONTAINER (no direct adapter imports), CONTRACTS_ARE_TRUTH, NODE_STORE_IS_LOCAL.
 * Moves (story.0033): create and patch resolve new metric links and pin baselines. Detail and bounded summary reads add authorized observations and directional verdicts.
 * Envelope (task.0118): `getWorkItem` is the one single-item read; each move also carries its metric, KPI and goal, and `includeLinks` adds the first page of citation links. List reads stay summary-sized.
 * Side-effects: IO (filesystem read via port; database read/write via Doltgres port)
 * Links: contracts/work.items.{list,get,create,patch}.v1.contract
 * @internal
 */

import type {
  WorkItemsCreateInput as ContractCreateInput,
  WorkItemsPatchInput as ContractPatchInput,
  WorkItemCoordinationOutput,
  WorkItemDto,
  WorkItemsListInput,
  WorkItemsListOutput,
  WorkItemSummariesListInput,
  WorkItemSummariesListOutput,
} from "@cogni/node-contracts";
import type {
  WorkBoardColumnPages,
  WorkItem,
  WorkItemId,
  WorkQuery,
  WorkSummaryReadOptions,
} from "@cogni/work-items";
import {
  composeItemEnvelope,
  judgeMoveSummaries,
  toWorkItemDto as toDto,
  toWorkItemId,
  toWorkItemsCreateInput,
  toWorkItemsPatchInput,
  WorkItemSummarySchema,
  WorkItemScoresInvalidError,
  WorkItemWriteOutcomeUnknownError,
} from "@cogni/work-items";

export { WorkItemScoresInvalidError, WorkItemWriteOutcomeUnknownError };

import {
  checkNodeAdmin,
  isPrivilegedPriority,
  NodeAdminRequiredError,
} from "@cogni/knowledge-store";
import { createCitationLinksPort } from "@/bootstrap/capabilities/citation-links";
import { createMoveMetricPorts } from "@/bootstrap/capabilities/work-item-moves";
import { getContainer } from "@/bootstrap/container";
import { WorkItemNotFoundError } from "@/bootstrap/evaluation-work-items";

/**
 * Thrown when the opaque pagination cursor cannot be decoded — translated
 * to HTTP 400 in the route layer instead of the wrapper's generic 500.
 * The adapter's cursor codec throws a structurally identical error
 * (`name === "InvalidCursorError"`); the facade detects by name and
 * rethrows its own copy so the app layer doesn't have to import from
 * `@/adapters/**` (forbidden by `no-restricted-imports`).
 */
export class InvalidCursorError extends Error {
  constructor(message = "invalid cursor") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export { NodeAdminRequiredError, WorkItemNotFoundError };

export class WorkItemForbiddenError extends Error {
  constructor(id: string) {
    super(`Not authorized to mutate work item: ${id}`);
    this.name = "WorkItemForbiddenError";
  }
}

/**
 * P0P1_IS_NODE_ADMIN (story.5101): refuse a priority <= 1 write unless the caller
 * is node admin (the container's `nodeAdmin` authority), BEFORE any store write.
 * Throws `NodeAdminRequiredError` (403 `authz_denied` / 503 `authz_unavailable`).
 */
async function assertPriorityAuthority(
  priority: number | null | undefined,
  actor: WorkItemActor,
): Promise<void> {
  if (!isPrivilegedPriority(priority)) return;
  const decision = await checkNodeAdmin(getContainer().nodeAdmin, {
    userId: actor.id,
    walletAddress: actor.walletAddress ?? null,
  });
  if (!decision.ok) {
    const err = new NodeAdminRequiredError(
      decision,
      `work.items.priority.p${priority}`,
    );
    getContainer().log.warn(
      {
        errorCode: err.errorCode,
        reason: err.reason,
        action: err.action,
        userId: actor.id,
      },
      "work.items.priority_node_admin_refused",
    );
    throw err;
  }
}

/** The caller of a work-item write; `walletAddress` is null for agent keys. */
export interface WorkItemActor {
  id: string;
  walletAddress?: string | null;
}

export class WorkItemLeaseConflictError extends Error {
  constructor(id: string) {
    super(`Work item is claimed by another principal or lease: ${id}`);
    this.name = "WorkItemLeaseConflictError";
  }
}

export class WorkItemsBackendNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkItemsBackendNotReadyError";
  }
}

/**
 * MOVES_READ_AT_READ_TIME: add each move's baseline, current reading and verdict to a
 * single item. Never throws: a lookup that fails reads `unknown`. A list read does not call this.
 */
async function withMoveReadings(
  dto: WorkItemDto,
  options?: WorkSummaryReadOptions,
): Promise<WorkItemDto> {
  if (!dto.moves?.length) return dto;
  const container = getContainer();
  // No metrics service on this node: every move reads `unknown` (metrics_unavailable).
  const readings = container.goalMetrics
    ? createMoveMetricPorts(() => container.goalMetrics).readings
    : undefined;
  return (await judgeMoveSummaries([dto], readings, options))[0] ?? dto;
}

async function withSummaryReadings<T extends { moves?: WorkItemDto["moves"] }>(
  items: readonly T[],
  options?: WorkSummaryReadOptions,
): Promise<T[]> {
  const container = getContainer();
  const readings = container.goalMetrics
    ? createMoveMetricPorts(() => container.goalMetrics).readings
    : undefined;
  return judgeMoveSummaries(items, readings, options);
}

function nextActionForWorkItem(item: WorkItem): string | null {
  if (item.blockedBy) return "blocked";
  switch (item.status) {
    case "needs_triage":
      return "/triage";
    case "needs_research":
      return "/research";
    case "needs_design":
      return "/design";
    case "needs_implement":
      return "/implement";
    case "needs_closeout":
      return "/closeout";
    case "needs_merge":
      return item.deployVerified ? "/merge" : "/validate-candidate";
    case "blocked":
      return "blocked";
    case "done":
    case "cancelled":
      return null;
  }
}

function rethrowBackendError(error: unknown): never {
  // Adapter/root entrypoints can bundle distinct constructors; normalize by identity fields.
  if (
    error instanceof Error &&
    error.name === "WorkItemWriteOutcomeUnknownError"
  ) {
    const unknown = error as Error & {
      operationId: string;
      branch: string;
      commitHash?: string;
      itemId?: string;
    };
    throw new WorkItemWriteOutcomeUnknownError(
      unknown.operationId,
      unknown.branch,
      unknown.commitHash,
      unknown.itemId,
    );
  }
  if (error instanceof Error && error.name === "WorkItemScoresInvalidError") {
    const invalid = error as Error & {
      issues: ConstructorParameters<typeof WorkItemScoresInvalidError>[0];
    };
    throw new WorkItemScoresInvalidError(invalid.issues);
  }
  const message = (error as Error)?.message ?? "";
  const notFound = /^Work item not found: (.+)$/.exec(message);
  if (notFound?.[1]) throw new WorkItemNotFoundError(notFound[1]);
  if (
    (error as Error)?.name === "DoltgresNotConfiguredError" ||
    (error as Error)?.name === "WorkItemsBusyError" ||
    (error as Error)?.name === "WorkItemsCapacityError" ||
    (error as Error)?.name === "DoltMergeOutcomeUnknownError"
  ) {
    throw new WorkItemsBackendNotReadyError(message);
  }
  if ((error as Error)?.name === "WorkItemAuthorizationError") {
    const id = (error as { id?: string }).id ?? "unknown";
    throw new WorkItemForbiddenError(id);
  }
  if ((error as Error)?.name === "WorkItemLeaseConflictError") {
    const id = (error as { id?: string }).id ?? "unknown";
    throw new WorkItemLeaseConflictError(id);
  }
  if ((error as Error)?.name === "WorkItemRevisionConflictError") {
    const conflict = error as Error & {
      id: string;
      expectedRevision: number;
      currentRevision: number;
    };
    throw new WorkItemRevisionConflictError(
      conflict.id,
      conflict.expectedRevision,
      conflict.currentRevision,
    );
  }
  throw error;
}

export class WorkItemRevisionConflictError extends Error {
  constructor(
    readonly id: string,
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Work item ${id} is at revision ${currentRevision}, expected ${expectedRevision}; nothing written`,
    );
    this.name = "WorkItemRevisionConflictError";
  }
}

export async function listWorkItems(
  input: WorkItemsListInput,
): Promise<WorkItemsListOutput> {
  const container = getContainer();
  const queryShared = {
    ...(input.sortBy && { sortBy: input.sortBy }),
    ...(input.sortDirection && { sortDirection: input.sortDirection }),
    ...(input.labels && { labels: input.labels }),
    ...(input.labelPrefix && { labelPrefix: input.labelPrefix }),
    ...(input.scored !== undefined && { scored: input.scored }),
    ...(input.types && { types: input.types as WorkItem["type"][] }),
    ...(input.statuses && { statuses: input.statuses as WorkItem["status"][] }),
    ...(input.text && { text: input.text }),
    ...(input.actor && { actor: input.actor as WorkItem["actor"] }),
    ...(input.projectId && { projectId: toWorkItemId(input.projectId) }),
    ...(input.node && { node: input.node }),
    ...(input.limit && { limit: input.limit }),
    ...(input.cursor && { cursor: input.cursor }),
  };

  // Exactly one backend owns the total order and its cursor (task.0056). The
  // former page-1 merge read the whole markdown backlog on every first page;
  // Beacon has no markdown work items, so it only cost an unbounded read.
  // Configured Doltgres failures stay errors; only genuinely absent
  // configuration selects markdown.
  try {
    const result = await container.doltgresWorkItems.list(queryShared);
    return {
      items: result.items.map(toDto),
      pageInfo: result.pageInfo,
      ...(result.pageInfo.endCursor !== null && {
        nextCursor: result.pageInfo.endCursor,
      }),
    };
  } catch (e) {
    rethrowReadUnlessNotConfigured(e);
  }
  try {
    const result = await container.workItemQuery.list(queryShared);
    return {
      items: result.items.map(toDto),
      pageInfo: {
        endCursor: result.nextCursor ?? null,
        hasMore: result.nextCursor !== undefined,
      },
      ...(result.nextCursor !== undefined && { nextCursor: result.nextCursor }),
    };
  } catch (e) {
    if ((e as Error)?.name === "InvalidCursorError")
      throw new InvalidCursorError((e as Error).message);
    throw e;
  }
}

/** Map a store read failure; returns only when Doltgres is not configured. */
function rethrowReadUnlessNotConfigured(error: unknown): void {
  const name = (error as Error)?.name;
  if (name === "InvalidCursorError") {
    throw new InvalidCursorError((error as Error).message);
  }
  if (name !== "DoltgresNotConfiguredError") rethrowBackendError(error);
}

/** The store query for one decoded summary request (the published codec already bounded it). */
function summaryQuery(input: WorkItemSummariesListInput): WorkQuery {
  return {
    ...(input.sortBy !== undefined && { sortBy: input.sortBy }),
    ...(input.sortDirection !== undefined && {
      sortDirection: input.sortDirection,
    }),
    ...(input.types && { types: input.types as WorkItem["type"][] }),
    ...(input.statuses && { statuses: input.statuses as WorkItem["status"][] }),
    ...(input.text && { text: input.text }),
    ...(input.actor && { actor: input.actor as WorkItem["actor"] }),
    ...(input.projectId && { projectId: toWorkItemId(input.projectId) }),
    ...(input.projectIds && { projectIds: input.projectIds.map(toWorkItemId) }),
    ...(input.rankMin !== undefined && { rankMin: input.rankMin }),
    ...(input.rankMax !== undefined && { rankMax: input.rankMax }),
    ...(input.node && { node: input.node }),
    ...(input.labels && { labels: input.labels }),
    ...(input.labelPrefix !== undefined && { labelPrefix: input.labelPrefix }),
    ...(input.scored !== undefined && { scored: input.scored }),
    limit: input.limit ?? 25,
    ...(input.cursor && { cursor: input.cursor }),
  };
}

/**
 * One bounded summary page (task.0056). `options` (signal, shared deadline,
 * scan budget) only tightens the read. Doltgres owns the page; markdown serves
 * it only when Doltgres is not configured (same rule as `listWorkItems`).
 */
export async function listWorkSummaries(
  input: WorkItemSummariesListInput,
  options?: WorkSummaryReadOptions,
): Promise<WorkItemSummariesListOutput> {
  const container = getContainer();
  const query = summaryQuery(input);
  try {
    const page = await container.doltgresWorkItems.listSummaries(
      query,
      options,
    );
    return { ...page, items: await withSummaryReadings(page.items, options) };
  } catch (error) {
    rethrowReadUnlessNotConfigured(error);
  }
  try {
    const result = await container.workItemQuery.list(query);
    return {
      items: await withSummaryReadings(
        result.items.map((item) => WorkItemSummarySchema.parse(toDto(item))),
        options,
      ),
      pageInfo: {
        endCursor: result.nextCursor ?? null,
        hasMore: result.nextCursor !== undefined,
      },
      ...(result.nextCursor !== undefined && { nextCursor: result.nextCursor }),
    };
  } catch (error) {
    if ((error as Error)?.name === "InvalidCursorError")
      throw new InvalidCursorError((error as Error).message);
    throw error;
  }
}

/**
 * First page of every listed board column in ONE store read when the port
 * composes it (task.0056); otherwise one bounded summary read per column.
 * Text queries never reach here (the package keeps them per-column).
 */
export async function listWorkBoardColumns(
  input: WorkItemSummariesListInput,
  statuses: readonly string[],
  perColumn: number,
  options?: WorkSummaryReadOptions,
): Promise<WorkBoardColumnPages> {
  const port = getContainer().doltgresWorkItems;
  if (port.listBoardColumns) {
    try {
      const page = await port.listBoardColumns(
        summaryQuery(input),
        statuses,
        perColumn,
        options,
      );
      const items = await withSummaryReadings(
        page.columns.flatMap((column) => column.items),
        options,
      );
      let offset = 0;
      return {
        ...page,
        columns: page.columns.map((column) => {
          const start = offset;
          offset += column.items.length;
          return { ...column, items: items.slice(start, offset) };
        }),
      };
    } catch (error) {
      rethrowReadUnlessNotConfigured(error);
    }
  }
  const columns = [];
  for (const status of statuses) {
    const page = await listWorkSummaries(
      { ...input, statuses: [status], limit: perColumn },
      options,
    );
    columns.push({ status, items: page.items, pageInfo: page.pageInfo });
  }
  return { columns, queryCount: columns.length };
}

/** Single-item read options; `includeLinks` adds the first page of citation links (`?include=links`). */
export interface WorkItemReadOptions extends WorkSummaryReadOptions {
  readonly includeLinks?: boolean;
  /** Set false for a caller that needs only the stored move ids (the EDO expectations read). Default: resolve the chain. */
  readonly chain?: boolean;
}

/**
 * THE single-item envelope (task.0118): the stored item plus, for each move, its readings, verdict
 * and the metric → KPI → goal chain, and optionally the first page of citation links. Moves and
 * links read together, so neither adds a round trip to the other. Never throws for either: an
 * unresolved chain reads `context: "unavailable"` and unreadable links read `unavailable`.
 */
async function withItemEnvelope(
  dto: WorkItemDto,
  options?: WorkItemReadOptions,
): Promise<WorkItemDto> {
  const container = getContainer();
  const readings = container.goalMetrics
    ? createMoveMetricPorts(
        () => container.goalMetrics,
        () => container.knowledgeStorePort,
      ).readings
    : undefined;
  // ONE_COMPOSITION: the same `composeItemEnvelope` the agent tool's capability calls.
  return composeItemEnvelope(
    dto,
    {
      readings,
      links: createCitationLinksPort(() => container.knowledgeStorePort),
      log: (event) => container.log.warn(event, "work.items.envelope_degraded"),
    },
    options,
  );
}

export async function getWorkItem(
  id: string,
  options?: WorkItemReadOptions,
): Promise<WorkItemDto | null> {
  const container = getContainer();
  // Doltgres-first: legacy markdown IDs (e.g. bug.0002) can also live in Doltgres
  // after the markdown→Doltgres import (task.5002). Fall back to markdown only when
  // Doltgres returns null, so unimported legacy IDs still resolve during transition.
  try {
    const item = await container.doltgresWorkItems.get(toWorkItemId(id));
    if (item) return await withItemEnvelope(toDto(item), options);
  } catch (e) {
    if ((e as Error)?.name !== "DoltgresNotConfiguredError") {
      rethrowBackendError(e);
    }
  }
  const mdItem = await container.workItemQuery.get(id as WorkItemId);
  return mdItem ? withItemEnvelope(toDto(mdItem), options) : null;
}

export async function createWorkItem(
  input: ContractCreateInput,
  sessionUser: WorkItemActor,
): Promise<WorkItemDto> {
  await assertPriorityAuthority(input.priority, sessionUser);
  const container = getContainer();
  try {
    const created = await container.doltgresWorkItems.create(
      toWorkItemsCreateInput(input),
      sessionUser.id,
    );
    return await withMoveReadings(toDto(created));
  } catch (e) {
    rethrowBackendError(e);
  }
}

export async function patchWorkItem(
  input: ContractPatchInput,
  sessionUser: WorkItemActor,
): Promise<WorkItemDto> {
  await assertPriorityAuthority(input.set.priority, sessionUser);
  const container = getContainer();
  try {
    const patched = await container.doltgresWorkItems.patch(
      toWorkItemsPatchInput(input),
      sessionUser.id,
    );
    if (!patched) throw new WorkItemNotFoundError(input.id);
    return await withMoveReadings(toDto(patched));
  } catch (e) {
    rethrowBackendError(e);
  }
}

export async function deleteWorkItem(
  id: string,
  sessionUser: { id: string },
): Promise<boolean> {
  const container = getContainer();
  try {
    return await container.doltgresWorkItems.delete(
      toWorkItemId(id),
      sessionUser.id,
    );
  } catch (e) {
    rethrowBackendError(e);
  }
}

export async function claimWorkItem(input: {
  id: string;
  runId: string;
  command: string;
  principalId: string;
}): Promise<WorkItemDto> {
  const container = getContainer();
  try {
    const item = await container.doltgresWorkItems.claim({
      id: toWorkItemId(input.id),
      runId: input.runId,
      command: input.command,
      principalId: input.principalId,
    });
    return toDto(item);
  } catch (error) {
    rethrowBackendError(error);
  }
}

export async function releaseWorkItem(input: {
  id: string;
  runId: string;
  principalId: string;
}): Promise<WorkItemDto> {
  const container = getContainer();
  try {
    const item = await container.doltgresWorkItems.release({
      id: toWorkItemId(input.id),
      runId: input.runId,
      principalId: input.principalId,
    });
    return toDto(item);
  } catch (error) {
    rethrowBackendError(error);
  }
}

export async function heartbeatWorkItem(input: {
  id: string;
  runId: string;
  command?: string;
  principalId: string;
}): Promise<WorkItemDto> {
  const container = getContainer();
  try {
    const item = await container.doltgresWorkItems.heartbeat({
      id: toWorkItemId(input.id),
      runId: input.runId,
      ...(input.command !== undefined && { command: input.command }),
      principalId: input.principalId,
    });
    return toDto(item);
  } catch (error) {
    rethrowBackendError(error);
  }
}

export async function getWorkItemCoordination(
  id: string,
): Promise<WorkItemCoordinationOutput> {
  const container = getContainer();
  try {
    const current = await container.doltgresWorkItems.get(toWorkItemId(id));
    if (!current) throw new WorkItemNotFoundError(id);
    return {
      nextAction: nextActionForWorkItem(current),
      session: {
        status: current.claimedByRun ? "active" : "none",
        claimedByRun: current.claimedByRun ?? null,
        claimedByDisplayName: current.claimedByRun ?? null,
        claimedAt: current.claimedAt ?? null,
        lastCommand: current.lastCommand ?? null,
      },
    };
  } catch (error) {
    if (error instanceof WorkItemNotFoundError) throw error;
    rethrowBackendError(error);
  }
}
