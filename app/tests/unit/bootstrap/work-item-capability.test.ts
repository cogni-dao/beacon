// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Published update/EDO contracts at Beacon's real capability seam; no database claims. */
import { WorkItemPatchConflictError } from "@cogni/ai-tools";
import {
  createWorkItemWriters,
  createRunAttribution,
  toWorkItemId,
  WorkItemRevisionConflictError,
  WorkItemWriteOutcomeUnknownError,
  type WorkItemsPort,
  type WorkItem,
} from "@cogni/work-items";
import {
  bindEdoToolCapability,
  type EdoCapability,
} from "@cogni/knowledge-store";
import { describe, expect, it, vi } from "vitest";
import { createWorkItemCapability } from "@/bootstrap/capabilities/work-item";
import {
  getExecutionScope,
  resolveExecutionScope,
  runInScope,
  type ExecutionScope,
} from "@/adapters/server/ai/execution-scope";

const item: WorkItem = {
  id: toWorkItemId("task.0001"),
  type: "task",
  title: "fixture",
  status: "needs_implement",
  node: "beacon",
  actor: "either",
  revision: 8,
  labels: [],
  assignees: [],
  externalRefs: [],
  specRefs: [],
  deployVerified: false,
  createdAt: "2026-11-26",
  updatedAt: "2026-11-26",
};
const scope = {
  subjectUserId: "requesting-human",
  runId: "run-1",
  runKind: "system_scheduled",
  billing: { billingAccountId: "payer-account", virtualKeyId: "billing-key" },
  usageSource: "litellm",
} as ExecutionScope;
const log = { info: vi.fn(), warn: vi.fn() };
function fixture() {
  const store = {
    get: vi.fn().mockResolvedValue(item),
    list: vi
      .fn()
      .mockResolvedValue({
        items: [item],
        pageInfo: { hasMore: false, endCursor: null },
      }),
    patch: vi.fn().mockResolvedValue({ ...item, revision: 9 }),
    historyPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
  const writers = createWorkItemWriters({
    log,
    scope: getExecutionScope,
    traceId: () => "trace-1",
    store: () => store as never,
    artifacts: () => undefined,
  });
  return {
    store,
    cap: createWorkItemCapability({
      workItemQuery: store as never,
      workItemCommand: {} as never,
      liveStore: () => store as unknown as WorkItemsPort,
      writers,
      artifactDeps: () => undefined,
    }),
  };
}
async function run<T>(fn: () => T) {
  const resolved = await resolveExecutionScope(
    scope,
    "prioritizer",
    async () => "actual-agent-row",
  );
  return runInScope(resolved, fn);
}
describe("Beacon released writers", () => {
  it("resolves the catalog principal, preserves requester/run and discards an inherited actor", async () => {
    const resolve = vi.fn().mockResolvedValue("actual-agent-row");
    const actual = await resolveExecutionScope(
      { ...scope, principalId: "forged-inherited" },
      "prioritizer",
      resolve,
    );
    expect(resolve).toHaveBeenCalledExactlyOnceWith("prioritizer");
    expect(actual).toMatchObject({
      principalId: "actual-agent-row",
      subjectUserId: "requesting-human",
      runId: "run-1",
      runKind: "system_scheduled",
    });
  });
  it("forwards canonical update reason, cites, revision zero and set to the live store", async () => {
    const { store, cap } = fixture();
    const input = {
      id: item.id,
      expectedRevision: 0,
      reason: "Cancel superseded work",
      cites: [{ id: "activity-attribution" }],
      set: { status: "cancelled" as const },
    };
    await run(() => cap.patch(input));
    expect(store.patch).toHaveBeenCalledWith(input, {
      actor: "actual-agent-row",
      requestedBy: "requesting-human",
      run: { id: "run-1", kind: "system_scheduled" },
    });
  });
  it.each([
    undefined,
    "missing-row",
  ])("no principal never writes as requester (%s)", async (slug) => {
    const { store, cap } = fixture();
    const actual = await resolveExecutionScope(
      { ...scope, principalId: "inherited" },
      slug,
      async () => null,
    );
    await expect(
      runInScope(actual, () =>
        cap.patch({
          id: item.id,
          reason: "Test refusal",
          set: { priority: 3 },
        }),
      ),
    ).rejects.toThrow();
    expect(store.patch).not.toHaveBeenCalled();
  });
  it("preserves Beacon's privileged priority refusal", async () => {
    const { store, cap } = fixture();
    await expect(
      run(() =>
        cap.patch({
          id: item.id,
          reason: "Raise priority",
          set: { priority: 0 },
        }),
      ),
    ).rejects.toThrow("authz_denied");
    expect(store.patch).not.toHaveBeenCalled();
  });
  it("maps the installed store's CAS conflict for the released update tool", async () => {
    const { store, cap } = fixture();
    store.patch.mockRejectedValue(
      new WorkItemRevisionConflictError(item.id, 7, 8),
    );
    await expect(
      run(() =>
        cap.patch({
          id: item.id,
          expectedRevision: 7,
          reason: "Try stale change",
          set: {},
        }),
      ),
    ).rejects.toBeInstanceOf(WorkItemPatchConflictError);
  });
  it("never retries an uncertain write", async () => {
    const { store, cap } = fixture();
    const failure = new WorkItemWriteOutcomeUnknownError(
      "operation-1",
      "branch-1",
      undefined,
      item.id,
    );
    store.patch.mockRejectedValue(failure);
    await expect(
      run(() =>
        cap.patch({ id: item.id, reason: "Preserve unknown result", set: {} }),
      ),
    ).rejects.toBe(failure);
    expect(store.patch).toHaveBeenCalledTimes(1);
  });
  it("retains query cursors and forwards full envelope options", async () => {
    const { store, cap } = fixture();
    if (!cap.read) throw new Error("Item read must be wired");
    await cap.read(item.id, {
      includeLinks: true,
      includeArtifacts: true,
      includeHistory: true,
    });
    expect(store.list).toHaveBeenCalledWith({ ids: [item.id], limit: 1 });
    expect(store.historyPage).toHaveBeenCalledTimes(1);
  });
  it("binds each EDO write at invocation and preserves decision confidence", async () => {
    const decide = vi.fn().mockResolvedValue({ id: "decision-1" });
    const edo = bindEdoToolCapability(
      { decide } as unknown as EdoCapability,
      createRunAttribution({ scope: getExecutionScope, log }),
    );
    const input = {
      id: "decision-1",
      confidencePct: 73,
      derivesFromHypothesisId: "hypothesis-1",
    } as Parameters<typeof edo.decide>[0];
    await run(() => edo.decide(input));
    expect(decide).toHaveBeenCalledWith(input, {
      actor: "actual-agent-row",
      requestedBy: "requesting-human",
      run: { id: "run-1", kind: "system_scheduled" },
    });
  });
});
