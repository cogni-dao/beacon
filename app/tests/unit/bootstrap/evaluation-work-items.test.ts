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
    listSummaries: vi.fn().mockResolvedValue({
      items: [],
      pageInfo: { endCursor: null, hasMore: false },
    }),
    history: vi.fn().mockResolvedValue([]),
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
    // BOUNDED_CLAIM_OVERLAY (task.0056): one keyed read of exactly this page's ids.
    expect(legacy.list).toHaveBeenCalledWith({ ids: [item.id], limit: 1 });
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


describe("change reasons and row history", () => {
  it("delegates listSummaries and history to the published content store", async () => {
    const { store, content } = fixture();
    await store.listSummaries({});
    await store.history?.(item.id);
    // Read options are forwarded too (task.0056); none were passed here.
    expect(content.listSummaries).toHaveBeenCalledWith({}, undefined);
    expect(content.history).toHaveBeenCalledWith(item.id);
  });
  it("forwards a patch reason through the facade to the store", async () => {
    backend.patch.mockResolvedValueOnce(item);
    await patchWorkItem(
      { id: item.id, reason: "why", set: { priority: 3 } },
      { id: "actor" },
    );
    expect(backend.patch).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "why" }),
      "actor",
    );
  });
});

describe("read forwarding (task.0056)", () => {
  it("forwards listSummaries read options (signal, text deadline, scan cap) to the content store", async () => {
    const { store, content } = fixture();
    const options = { signal: new AbortController().signal, deadline: 1_700_000_000_000, maxScanRows: 400 };
    const query = { statuses: ["needs_design" as WorkItem["status"]], text: "needle", limit: 20 };
    await store.listSummaries(query, options);
    expect(content.listSummaries).toHaveBeenCalledWith(query, options);
  });
  it("forwards the composed board read to the content store and never touches legacy claims", async () => {
    const { content, legacy } = fixture();
    const pages = { columns: [], queryCount: 1 };
    const listBoardColumns = vi.fn().mockResolvedValue(pages);
    const store = composeEvaluationWorkItems(
      { ...content, listBoardColumns } as unknown as WorkItemsContentPort,
      legacy as unknown as LegacyPort,
    );
    const options = { signal: new AbortController().signal };
    await expect(
      store.listBoardColumns?.({ limit: 20 }, ["needs_design", "done"], 20, options),
    ).resolves.toBe(pages);
    expect(listBoardColumns).toHaveBeenCalledWith({ limit: 20 }, ["needs_design", "done"], 20, options);
    expect(legacy.list).not.toHaveBeenCalled();
  });
  it("omits listBoardColumns when the content store has none", () => {
    const { store } = fixture();
    expect(store.listBoardColumns).toBeUndefined();
  });
});

describe("bounded work reads (task.0056)", () => {
  it("fetches exactly one summaries page and never walks its cursor", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ items: [item], pageInfo: { hasMore: true, endCursor: "page-two" } }));
    try {
      const params = new URLSearchParams({ limit: "25", sortBy: "rankScore", sortDirection: "desc" });
      const page = await fetchWorkItems(params);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]?.[0])).toBe(`/api/v1/work/summaries?${params}`);
      expect(page.pageInfo).toEqual({ hasMore: true, endCursor: "page-two" });
    } finally { fetch.mockRestore(); }
  });
  it("rejects with the HTTP status so the package hooks retry only 5xx", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ error: "Work-item store is busy" }, { status: 503 }));
    try {
      await expect(fetchWorkItems(new URLSearchParams())).rejects.toMatchObject({ status: 503 });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fetch.mockRestore(); }
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
