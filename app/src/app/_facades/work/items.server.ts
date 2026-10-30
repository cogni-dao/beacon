// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/work/items.server`
 * Purpose: Server-side facade for work item read/write operations across the markdown + Doltgres surfaces.
 * Scope: Maps port results to contract DTOs and merges node-local Doltgres rows with legacy markdown rows.
 * Invariants: P0P1_IS_NODE_ADMIN (story.5101: priority <= 1 on create/patch requires node admin,
 *   checked before the store write), PORT_VIA_CONTAINER (no direct adapter imports), CONTRACTS_ARE_TRUTH, NODE_STORE_IS_LOCAL.
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
} from "@cogni/node-contracts";
import type { WorkItem, WorkItemId } from "@cogni/work-items";
import {
  toWorkItemDto as toDto,
  toWorkItemId,
  WorkItemScoresInvalidError,
  WorkItemWriteOutcomeUnknownError,
} from "@cogni/work-items";

export { WorkItemScoresInvalidError, WorkItemWriteOutcomeUnknownError };

import {
  checkNodeAdmin,
  isPrivilegedPriority,
  NodeAdminRequiredError,
} from "@cogni/knowledge-store";
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

type StripUndefined<T> = {
  [K in keyof T]?: Exclude<T[K], undefined>;
};

function dropUndefined<T extends Record<string, unknown>>(
  obj: T,
): StripUndefined<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as StripUndefined<T>;
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

  // Pagination strategy:
  //   - Doltgres is the cursor-paginated source of truth (post-#1144 importer
  //     back-fills markdown items into Doltgres at their original IDs).
  //   - On the first page (no cursor) we ALSO query the markdown adapter so
  //     any items that haven't been imported yet still appear. Doltgres rows
  //     win on id conflict (single-source dedup).
  //   - Merged page is truncated to `limit` so the response never overflows.
  //   - hasMore tracks Doltgres only — markdown is finite/small and only
  //     contributes to page 1; once Doltgres exhausts pagination ends.
  //   - Markdown-only items that overflow page 1 are dropped from the response;
  //     this is acceptable because markdown is being deprecated and the
  //     importer back-fill closes the gap.
  let dgItems: WorkItem[] = [];
  let endCursor: string | null = null;
  let hasMore = false;

  try {
    const dgResult = await container.doltgresWorkItems.list(queryShared);
    dgItems = [...dgResult.items];
    endCursor = dgResult.pageInfo.endCursor;
    hasMore = dgResult.pageInfo.hasMore;
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "InvalidCursorError") {
      throw new InvalidCursorError((e as Error).message);
    }
    if (name !== "DoltgresNotConfiguredError") rethrowBackendError(e);
  }

  let merged: WorkItem[] = dgItems;
  if (!input.cursor) {
    const mdResult = await container.workItemQuery.list(queryShared);
    const dgIds = new Set(dgItems.map((i) => i.id as string));
    const mdOnly = mdResult.items.filter((i) => !dgIds.has(i.id as string));
    merged = [...dgItems, ...mdOnly];
  }

  const requestedLimit = input.limit ?? 100;
  if (merged.length > requestedLimit) {
    merged = merged.slice(0, requestedLimit);
  }

  return {
    items: merged.map(toDto),
    pageInfo: { endCursor, hasMore },
    ...(endCursor !== null && { nextCursor: endCursor }),
  };
}

export async function getWorkItem(id: string): Promise<WorkItemDto | null> {
  const container = getContainer();
  // Doltgres-first: legacy markdown IDs (e.g. bug.0002) can also live in Doltgres
  // after the markdown→Doltgres import (task.5002). Fall back to markdown only when
  // Doltgres returns null, so unimported legacy IDs still resolve during transition.
  try {
    const item = await container.doltgresWorkItems.get(toWorkItemId(id));
    if (item) return toDto(item);
  } catch (e) {
    if ((e as Error)?.name !== "DoltgresNotConfiguredError") {
      rethrowBackendError(e);
    }
  }
  const mdItem = await container.workItemQuery.get(id as WorkItemId);
  return mdItem ? toDto(mdItem) : null;
}

export async function createWorkItem(
  input: ContractCreateInput,
  sessionUser: WorkItemActor,
): Promise<WorkItemDto> {
  await assertPriorityAuthority(input.priority, sessionUser);
  const container = getContainer();
  try {
    const created = await container.doltgresWorkItems.create(
      {
        type: input.type,
        title: input.title,
        ...(input.id !== undefined && { id: toWorkItemId(input.id) }),
        ...(input.summary !== undefined && { summary: input.summary }),
        ...(input.outcome !== undefined && { outcome: input.outcome }),
        ...(input.specRefs !== undefined && { specRefs: input.specRefs }),
        ...(input.projectId !== undefined && {
          projectId: toWorkItemId(input.projectId),
        }),
        ...(input.parentId !== undefined && {
          parentId: toWorkItemId(input.parentId),
        }),
        ...(input.labels !== undefined && { labels: input.labels }),
        ...(input.assignees !== undefined && { assignees: input.assignees }),
        ...(input.node !== undefined && { node: input.node }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.rank !== undefined && { rank: input.rank }),
        ...(input.estimate !== undefined && { estimate: input.estimate }),
        ...(input.scores !== undefined && { scores: input.scores }),
      },
      sessionUser.id,
    );
    return toDto(created);
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
      {
        id: toWorkItemId(input.id),
        set: dropUndefined(input.set),
        ...(input.expectedRevision !== undefined && {
          expectedRevision: input.expectedRevision,
        }),
      },
      sessionUser.id,
    );
    if (!patched) throw new WorkItemNotFoundError(input.id);
    return toDto(patched);
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
