// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/work-item-capability`
 * Purpose: The AI work-item capability queries the live (Doltgres) backlog when wired, and refuses AI patches
 *   to priority <= 1.
 * Scope: Factory with fake ports. No Doltgres.
 * Invariants: QUERY_READS_THE_LIVE_BACKLOG, WRITES_NOT_WIDENED, P0P1_IS_NODE_ADMIN.
 * Side-effects: none
 * Links: src/bootstrap/capabilities/work-item.ts, story.5101
 * @internal
 */

import {
  createWorkItemQueryImplementation,
  WorkItemQueryOutputSchema,
  workItemQueryContract,
} from "@cogni/shared-ai-tools";
import type {
  WorkItem,
  WorkItemCommandPort,
  WorkItemQueryPort,
  WorkItemsContentPort,
} from "@cogni/work-items";
import { toWorkItemId, WorkItemDtoSchema } from "@cogni/work-items";
import { describe, expect, it, vi } from "vitest";
import { createWorkItemCapability } from "@/bootstrap/capabilities/work-item";
import {
  composeEvaluationWorkItems,
  WorkItemNotFoundError,
} from "@/bootstrap/evaluation-work-items";
import type { EvaluationWorkItemsPort } from "@/ports/work-items";
import { makeLangChainTool } from "../../../../packages/langgraph-graphs/src/runtime/core/langchain-tools";

const empty = { items: [], pageInfo: { endCursor: null, hasMore: false } };

describe("createWorkItemCapability", () => {
  it("query reads the backlogReader (live backlog), not the markdown port", async () => {
    const markdown = { list: vi.fn().mockResolvedValue(empty), get: vi.fn() };
    const backlog = { list: vi.fn().mockResolvedValue(empty) };
    const cap = createWorkItemCapability({
      workItemQuery: markdown as unknown as WorkItemQueryPort,
      workItemCommand: {} as WorkItemCommandPort,
      backlogReader: backlog as unknown as Pick<WorkItemQueryPort, "list">,
    });
    await cap.query({ statuses: ["needs_implement"] });
    expect(backlog.list).toHaveBeenCalledTimes(1);
    expect(backlog.list).toHaveBeenCalledWith({
      statuses: ["needs_implement"],
    });
    expect(markdown.list).not.toHaveBeenCalled();
  });

  it("query falls back to the query port when no backlogReader is wired", async () => {
    const markdown = { list: vi.fn().mockResolvedValue(empty), get: vi.fn() };
    const cap = createWorkItemCapability({
      workItemQuery: markdown as unknown as WorkItemQueryPort,
      workItemCommand: {} as WorkItemCommandPort,
    });
    await cap.query({ statuses: ["needs_implement"] });
    expect(markdown.list).toHaveBeenCalledWith({
      statuses: ["needs_implement"],
    });
  });

  it("an AI patch to priority <= 1 is refused before any write", async () => {
    const command = { patch: vi.fn() };
    const cap = createWorkItemCapability({
      workItemQuery: {
        list: vi.fn(),
        get: vi.fn(),
      } as unknown as WorkItemQueryPort,
      workItemCommand: command as unknown as WorkItemCommandPort,
    });
    await expect(
      cap.patch({ id: "task.5001", set: { priority: 0 } }),
    ).rejects.toThrow("authz_denied");
    expect(command.patch).not.toHaveBeenCalled();
  });

  it("WRITES_NOT_WIDENED: transitionStatus/patch stay on workItemQuery + workItemCommand, never the backlogReader", async () => {
    const item = { id: "task.5001", status: "needs_implement", revision: 3 };
    const markdown = { list: vi.fn(), get: vi.fn().mockResolvedValue(item) };
    const command = {
      transitionStatus: vi
        .fn()
        .mockResolvedValue({ ...item, status: "done", revision: 4 }),
      patch: vi.fn().mockResolvedValue({
        ...item,
        type: "task",
        title: "t",
        labels: [],
        assignees: [],
        externalRefs: [],
        specRefs: [],
      }),
    };
    const backlog = { list: vi.fn() };
    const cap = createWorkItemCapability({
      workItemQuery: markdown as unknown as WorkItemQueryPort,
      workItemCommand: command as unknown as WorkItemCommandPort,
      backlogReader: backlog as unknown as Pick<WorkItemQueryPort, "list">,
    });
    await cap.transitionStatus({ id: "task.5001", toStatus: "done" });
    await cap.patch({ id: "task.5001", set: { priority: 3 } });
    expect(markdown.get).toHaveBeenCalledTimes(2);
    expect(command.transitionStatus).toHaveBeenCalledTimes(1);
    expect(command.patch).toHaveBeenCalledTimes(1);
    expect(backlog.list).not.toHaveBeenCalled();
  });
});

describe("published evaluation writer binding", () => {
  const item = {
    id: toWorkItemId("task.0001"),
    type: "task" as const,
    title: "fixture",
    outcome: "preserve complete read context",
    status: "needs_implement" as const,
    node: "beacon",
    actor: "either" as const,
    labels: [],
    assignees: [],
    externalRefs: [],
    specRefs: [],
    revision: 7,
    deployVerified: false,
    createdAt: "2026-10-23",
    updatedAt: "2026-10-23",
    priority: 3,
  };
  const scores = {
    goal: { v: 2 },
    unblocks: { v: 3 },
    time: { v: 1 },
    ease: { v: 2 },
    confidence: { v: 3 },
    agent: { v: 2 },
  };
  it("inherits every canonical read field and preserves filters, revision and trusted provenance through the installed wrapper", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [{ ...item, sourceUrl: "https://untrusted.invalid/spoof" }],
      nextCursor: "next-page",
      pageInfo: { endCursor: "next-page", hasMore: true },
    });
    const capability = createWorkItemCapability({
      workItemQuery: {} as WorkItemQueryPort,
      workItemCommand: {} as WorkItemCommandPort,
      liveStore: () => ({ list }) as unknown as EvaluationWorkItemsPort,
    });
    const implementation = createWorkItemQueryImplementation({
      workItemCapability: capability,
      nodePublicOrigin: "https://beacon.cognidao.org",
    });
    const output = await implementation.execute({
      labels: ["adoption"],
      labelPrefix: "fleet",
      scored: false,
      sortBy: "updatedAt",
      sortDirection: "asc",
      cursor: "previous-page",
      limit: 1,
    });
    expect(list).toHaveBeenCalledWith({
      labels: ["adoption"],
      labelPrefix: "fleet",
      scored: false,
      sortBy: "updatedAt",
      sortDirection: "asc",
      cursor: "previous-page",
      limit: 1,
    });
    const parsed = WorkItemQueryOutputSchema.parse(output);
    expect(
      Object.keys(WorkItemQueryOutputSchema.shape.items.element.shape),
    ).toEqual(expect.arrayContaining(Object.keys(WorkItemDtoSchema.shape)));
    expect(parsed.items[0]).toMatchObject({
      revision: 7,
      outcome: item.outcome,
      createdAt: item.createdAt,
      sourceUrl: "https://beacon.cognidao.org/work/items/task.0001",
    });
    expect(parsed.nextCursor).toBe("next-page");
    const exec = vi.fn().mockResolvedValue({ ok: true, value: parsed });
    const tool = makeLangChainTool({
      contract: workItemQueryContract,
      execResolver: () => exec,
    });
    const denied = JSON.parse(await tool.invoke({ limit: 1 }));
    expect(denied.error).toBe("policy_denied");
    expect(exec).not.toHaveBeenCalled();
    const result = JSON.parse(
      await tool.invoke(
        { limit: 1 },
        { configurable: { toolIds: [workItemQueryContract.name] } },
      ),
    );
    expect(result).toEqual(parsed);
  });

  it("reads the current trusted actor at each call and forwards whole-score CAS without priority", async () => {
    let actor = "actor-a";
    const patch = vi.fn().mockResolvedValue({ ...item, scores, revision: 8 });
    const store = {
      get: vi.fn().mockResolvedValue(item),
      patch,
    } as unknown as EvaluationWorkItemsPort;
    const capability = createWorkItemCapability({
      workItemQuery: {} as WorkItemQueryPort,
      workItemCommand: {} as WorkItemCommandPort,
      liveStore: () => store,
      getActorId: () => actor,
    });
    const result = await capability.patch({
      id: item.id,
      expectedRevision: 7,
      set: { scores },
    });
    expect(patch).toHaveBeenLastCalledWith(
      { id: item.id, expectedRevision: 7, set: { scores } },
      "actor-a",
    );
    expect(result.scores).toEqual(scores);
    expect(result.rankScore).toBeTypeOf("number");
    expect(result.revision).toBe(8);
    expect(result.createdAt).toBe(item.createdAt);
    expect(result.externalRefs).toEqual(item.externalRefs);
    expect(result.specRefs).toEqual(item.specRefs);
    actor = "actor-b";
    await capability.patch({
      id: item.id,
      expectedRevision: 8,
      set: { scores: null },
    });
    expect(patch).toHaveBeenLastCalledWith(
      { id: item.id, expectedRevision: 8, set: { scores: null } },
      "actor-b",
    );
  });
  it("refuses missing trusted actors and human-only priority before store writes", async () => {
    const patch = vi.fn();
    const store = {
      get: vi.fn().mockResolvedValue(item),
      patch,
    } as unknown as EvaluationWorkItemsPort;
    const capability = createWorkItemCapability({
      workItemQuery: {} as WorkItemQueryPort,
      workItemCommand: {} as WorkItemCommandPort,
      liveStore: () => store,
      getActorId: () => "",
    });
    await expect(
      capability.patch({ id: item.id, set: { scores } }),
    ).rejects.toThrow("authenticated execution actor");
    await expect(
      capability.patch({ id: item.id, set: { priority: 1 } }),
    ).rejects.toThrow("authz_denied");
    expect(patch).not.toHaveBeenCalled();
  });
  it("translates bundled-store CAS identity into the published tool conflict", async () => {
    const conflict = Object.assign(new Error("moved"), {
      name: "WorkItemRevisionConflictError",
      expectedRevision: 7,
      currentRevision: 8,
    });
    const store = {
      get: vi.fn().mockResolvedValue(item),
      patch: vi.fn().mockRejectedValue(conflict),
    } as unknown as EvaluationWorkItemsPort;
    const capability = createWorkItemCapability({
      workItemQuery: {} as WorkItemQueryPort,
      workItemCommand: {} as WorkItemCommandPort,
      liveStore: () => store,
      getActorId: () => "actor-a",
    });
    await expect(
      capability.patch({ id: item.id, expectedRevision: 7, set: { scores } }),
    ).rejects.toMatchObject({
      name: "WorkItemPatchConflictError",
      expectedRevision: 7,
      currentRevision: 8,
    });
  });
});

describe("legacy lease writes refresh canonical content", () => {
  const id = toWorkItemId("task.0001");
  const current: WorkItem = {
    id,
    type: "task",
    title: "current content",
    status: "needs_implement",
    actor: "either",
    assignees: [],
    externalRefs: [],
    labels: [],
    specRefs: [],
    revision: 42,
    deployVerified: false,
    createdAt: "2026-10-30",
    updatedAt: "2026-10-30",
    claimedByRun: "stale-content-claim",
    claimedAt: "stale",
    lastCommand: "stale",
  };
  it.each(["claim", "heartbeat", "release"] as const)(
    "%s preserves legacy input/authority and returns only current revision with lease fields",
    async (method) => {
      const {
        claimedByRun: _run,
        claimedAt: _at,
        lastCommand: _command,
        ...legacyContent
      } = current;
      const lease = {
        ...legacyContent,
        title: "old lease content",
        revision: undefined,
        ...(method !== "release" && {
          claimedByRun: "legacy-run",
          claimedAt: "legacy-time",
          lastCommand: "legacy-command",
        }),
      };
      const write = vi.fn().mockResolvedValue(lease);
      const get = vi.fn().mockResolvedValue(current);
      const legacy = {
        claim: write,
        heartbeat: write,
        release: write,
        get: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
      };
      const port = composeEvaluationWorkItems(
        { get } as unknown as WorkItemsContentPort,
        legacy,
      );
      const input = {
        id,
        runId: "legacy-token",
        principalId: "trusted-actor",
        command: "existing-command",
      };
      const result = await port[method](input);
      expect(write).toHaveBeenCalledWith(input);
      expect(get).toHaveBeenCalledWith(id);
      expect(result).toMatchObject({ title: current.title, revision: 42 });
      expect(result.claimedByRun).toBe(lease.claimedByRun);
      expect(result.claimedAt).toBe(lease.claimedAt);
      expect(result.lastCommand).toBe(lease.lastCommand);
    },
  );
  it.each(["claim", "heartbeat", "release"] as const)(
    "%s refuses missing canonical content instead of returning the legacy row",
    async (method) => {
      const write = vi.fn().mockResolvedValue({
        id,
        title: "legacy only",
        claimedByRun: "legacy-run",
      });
      const legacy = {
        claim: write,
        heartbeat: write,
        release: write,
        get: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
      };
      const port = composeEvaluationWorkItems(
        {
          get: vi.fn().mockResolvedValue(null),
        } as unknown as WorkItemsContentPort,
        legacy,
      );
      await expect(
        port[method]({
          id,
          runId: "token",
          principalId: "actor",
          command: "command",
        }),
      ).rejects.toBeInstanceOf(WorkItemNotFoundError);
    },
  );
});
