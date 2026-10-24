// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Compatibility conformance: node composition never replaces published content or lease policy. */

import type { WorkItemsDoltgresPort as LegacyPort } from "@cogni/legacy-work-items/adapters/doltgres";
import {
  rankScore,
  toWorkItemId,
  type WorkItem,
  type WorkItemsContentPort,
} from "@cogni/work-items";
import { describe, expect, it, vi } from "vitest";
import { WorkItemWriteOutcomeUnknownError as AdapterUnknownError, WorkItemScoresInvalidError as AdapterScoresError } from "@cogni/work-items/adapters/doltgres";
import { patchWorkItem, WorkItemWriteOutcomeUnknownError, WorkItemScoresInvalidError } from "@/app/_facades/work/items.server";
const backend = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock("@/bootstrap/container", () => ({ getContainer: () => ({ doltgresWorkItems: backend }) }));

import { fetchWorkItems } from "@/app/(app)/work/_api/fetchWorkItems";
import { composeEvaluationWorkItems } from "@/bootstrap/evaluation-work-items";
import { WorkItemScoresSchema } from "../../../../packages/node-contracts/src/work.items.scores";

const item: WorkItem = {
  id: toWorkItemId("task.0001"),
  type: "task",
  title: "fixture",
  status: "needs_implement",
  node: "beacon",
  actor: "either",
  labels: [],
  assignees: [],
  externalRefs: [],
  specRefs: [],
  revision: 8,
  deployVerified: false,
  createdAt: "2026-10-23",
  updatedAt: "2026-10-23",
  scores: {
    goal: { v: 5, ev: "https://external.example/justification" },
    unblocks: { v: 2 },
    time: { v: 2 },
    ease: { v: 2 },
    confidence: { v: 2 },
    agent: { v: 2 },
  },
};
function fixture() {
  const old = {
    ...item,
    revision: 2,
    scores: undefined,
    claimedByRun: "run-a",
    claimedAt: "2026-10-23",
    lastCommand: "design",
  };
  const content = {
    get: vi.fn().mockResolvedValue(item),
    list: vi
      .fn()
      .mockResolvedValue({
        items: [item],
        pageInfo: { endCursor: null, hasMore: false },
      }),
    create: vi.fn().mockResolvedValue(item),
    patch: vi.fn().mockResolvedValue(item),
    delete: vi.fn(),
  };
  const legacy = {
    get: vi.fn().mockResolvedValue(old),
    list: vi.fn().mockResolvedValue({ items: [old] }),
    claim: vi.fn().mockResolvedValue(old),
    heartbeat: vi.fn().mockResolvedValue(old),
    release: vi
      .fn()
      .mockResolvedValue({
        ...old,
        claimedByRun: undefined,
        claimedAt: undefined,
      }),
    delete: vi.fn().mockResolvedValue(true),
  };
  return {
    content,
    legacy,
    store: composeEvaluationWorkItems(
      content as WorkItemsContentPort,
      legacy as unknown as LegacyPort,
    ),
  };
}
describe("published content with v1 lease compatibility", () => {
  it("keeps new scores/revision/order while projecting only active legacy claim fields", async () => {
    const { store, legacy } = fixture();
    const current = await store.get(item.id);
    expect(current).toMatchObject({
      revision: 8,
      scores: item.scores,
      claimedByRun: "run-a",
    });
    const page = await store.list();
    expect(page.items[0]).toMatchObject({
      revision: 8,
      scores: item.scores,
      claimedByRun: "run-a",
    });
    expect(legacy.list).toHaveBeenCalledWith({ ids: [item.id], limit: 500 });
    expect(rankScore(current?.scores)).toBe(rankScore(item.scores));
  });
  it("delegates unchanged v1 claim/heartbeat/release inputs and preserves new score readback", async () => {
    const { store, legacy } = fixture();
    const input = {
      id: item.id,
      runId: "run-a",
      principalId: "principal-a",
      command: "design",
    };
    expect(await store.claim(input)).toMatchObject({
      revision: 8,
      scores: item.scores,
      claimedByRun: "run-a",
    });
    await store.heartbeat(input);
    await store.release(input);
    expect(legacy.claim).toHaveBeenCalledWith(input);
    expect(legacy.heartbeat).toHaveBeenCalledWith(input);
    expect(legacy.release).toHaveBeenCalledWith(input);
    const conflict = Object.assign(new Error("owned by another run"), {
      name: "WorkItemLeaseConflictError",
    });
    legacy.heartbeat.mockRejectedValue(conflict);
    await expect(store.heartbeat({ ...input, runId: "wrong" })).rejects.toBe(
      conflict,
    );
  });
  it("preserves v1 DELETE while never falling back to legacy for protected content denial", async () => {
    const { store, content, legacy } = fixture();
    expect(await store.delete(item.id, "owner")).toBe(true);
    expect(legacy.delete).toHaveBeenCalledWith(item.id, "owner");
    expect(content.delete).not.toHaveBeenCalled();
    const denied = Object.assign(new Error("creator required"), {
      name: "WorkItemAuthorizationError",
    });
    content.patch.mockRejectedValue(denied);
    await expect(
      store.patch(
        { id: item.id, set: { title: "protected content", priority: 3 } },
        "other-principal",
      ),
    ).rejects.toBe(denied);
    expect(content.patch).toHaveBeenCalledExactlyOnceWith(
      { id: item.id, set: { title: "protected content", priority: 3 } },
      "other-principal",
    );
  });
  it("uses public validation for integer bounds/high-score justification and permits external HTTPS", () => {
    expect(WorkItemScoresSchema.safeParse(item.scores).success).toBe(true);
    expect(WorkItemScoresSchema.safeParse({ goal: { v: 5 } }).success).toBe(
      false,
    );
    expect(WorkItemScoresSchema.safeParse({ goal: { v: 1.5 } }).success).toBe(
      false,
    );
  });
});


describe("complete rank-view pagination", () => {
  it("loads later higher-ranked items and unscored rows before client sorting", async () => {
    const late = { ...item, id: toWorkItemId("task.0002"), rankScore: 20 };
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValueOnce(Response.json({ items: [{ ...item, rankScore: 1 }], pageInfo: { hasMore: true, endCursor: "page-two" } }));
    fetch.mockResolvedValueOnce(Response.json({ items: [late, { ...item, id: toWorkItemId("task.0003"), scores: undefined }], pageInfo: { hasMore: false, endCursor: null } }));
    try {
      const all = await fetchWorkItems();
      expect(all.items.map(row => row.id)).toEqual(["task.0001", "task.0002", "task.0003"]);
      expect(all.items[1]?.rankScore).toBe(20);
      expect(String(fetch.mock.calls[1]?.[0])).toContain("cursor=page-two");
      expect(all.pageInfo?.hasMore).toBe(false);
    } finally { fetch.mockRestore(); }
  });
  it("rejects a repeated cursor rather than exposing a silently truncated ranking", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ items: [item], pageInfo: { hasMore: true, endCursor: "same" } }));
    // Each request receives its own response body.
    fetch.mockImplementation(async () => Response.json({ items: [item], pageInfo: { hasMore: true, endCursor: "same" } }));
    try { await expect(fetchWorkItems()).rejects.toThrow("did not advance"); }
    finally { fetch.mockRestore(); }
  });
});


describe("cross-bundle HTTP error identity", () => {
  it("preserves the nonretryable unknown-write receipt rather than converting it to busy", async () => {
    const source = new AdapterUnknownError("operation-1", "work-item-op/operation-1", "commit-1", item.id);
    backend.patch.mockRejectedValueOnce(source);
    let caught: unknown;
    try { await patchWorkItem({ id: item.id, set: { scores: item.scores } }, { id: "actor" }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(WorkItemWriteOutcomeUnknownError);
    expect(caught).toMatchObject({ code: "work_item_write_outcome_unknown", retryable: false, receipt: source.receipt });
  });
  it("retains invalid-score issues in the facade identity used by the HTTP400 mapping", async () => {
    const issues = [{ code: "invalid_value", path: ["goal", "v"], message: "integer required" }];
    backend.patch.mockRejectedValueOnce(new AdapterScoresError(issues));
    await expect(patchWorkItem({ id: item.id, set: { scores: item.scores } }, { id: "actor" }))
      .rejects.toBeInstanceOf(WorkItemScoresInvalidError);
  });
});
