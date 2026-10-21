// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/facades/work-items`
 * Purpose: Unit test for work items facade — verifies DTO mapping and port delegation.
 * Scope: Mocks the service boundary; proves read DTOs, lease forwarding and actual mutation HTTP receipts.
 * Invariants: PORT_VIA_CONTAINER, CONTRACTS_ARE_TRUTH
 * Side-effects: none
 * Links: src/app/_facades/work/items.server.ts
 * @internal
 */

import {
  WorkItemDtoSchema,
  workItemsListOperation,
} from "@cogni/node-contracts";
import type { WorkItem, WorkItemQueryPort } from "@cogni/work-items";
import { toWorkItemId } from "@cogni/work-items";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the container
vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(),
}));

import {
  getWorkItem,
  listWorkItems,
  claimWorkItem,
  heartbeatWorkItem,
  releaseWorkItem,
  patchWorkItem,
} from "@/app/_facades/work/items.server";
import {
  KnowledgeBusyError,
  KnowledgeWriteConflictError,
  KnowledgeWriteOutcomeUnknownError,
  KnowledgeWriteScopeRequiredError,
} from "@cogni/knowledge-store";
import { WorkItemWriteOutcomeUnknownError } from "@cogni/work-items";
import type { SessionUser } from "@cogni/node-shared";
import {
  handleCreate,
  handleAppendCommit,
  handleMerge,
  handleClose,
} from "@/app/api/v1/knowledge/contributions/_handlers";
import { handleCreate as handleDomain } from "@/app/api/v1/knowledge/domains/_handlers";
import { handleHypothesize } from "@/app/api/v1/edo/_handlers";
import { getContainer } from "@/bootstrap/container";

const mockGetContainer = vi.mocked(getContainer);

const SAMPLE_WORK_ITEM: WorkItem = {
  id: toWorkItemId("task.0001"),
  type: "task",
  title: "Sample task",
  status: "needs_implement",
  priority: 1,
  rank: 5,
  estimate: 3,
  summary: "A test summary",
  outcome: "Expected outcome",
  projectId: toWorkItemId("proj.test"),
  parentId: undefined,
  assignees: [{ kind: "user", userId: "u1" }],
  externalRefs: [{ system: "github", kind: "pr" }],
  labels: ["test", "api"],
  specRefs: ["architecture-spec"],
  branch: "feat/task-0001",
  pr: undefined,
  reviewer: undefined,
  revision: 2,
  blockedBy: undefined,
  deployVerified: false,
  claimedByRun: undefined,
  claimedAt: undefined,
  lastCommand: undefined,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
};

function createMockPort(): WorkItemQueryPort {
  return {
    list: vi.fn(),
    get: vi.fn(),
  };
}

type DoltgresMock = {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

function createDoltgresMock(): DoltgresMock {
  // Default behavior: doltgres returns empty so the facade tests focus on
  // markdown path + DTO mapping.
  return {
    list: vi.fn().mockResolvedValue({
      items: [],
      pageInfo: { endCursor: null, hasMore: false },
    }),
    get: vi.fn(),
    create: vi.fn(),
    patch: vi.fn(),
  };
}

describe("app/_facades/work/items.server", () => {
  let mockPort: ReturnType<typeof createMockPort>;
  let mockDoltgres: DoltgresMock;

  beforeEach(() => {
    vi.resetAllMocks();
    mockPort = createMockPort();
    mockDoltgres = createDoltgresMock();
    mockGetContainer.mockReturnValue({
      workItemQuery: mockPort,
      doltgresWorkItems: mockDoltgres,
    } as never);
  });

  describe("listWorkItems", () => {
    it("returns items mapped to contract-compliant DTOs", async () => {
      vi.mocked(mockPort.list).mockResolvedValue({
        items: [SAMPLE_WORK_ITEM],
        nextCursor: undefined,
      });

      const result = await listWorkItems({});

      expect(result.items).toHaveLength(1);
      // Verify contract compliance
      expect(() => workItemsListOperation.output.parse(result)).not.toThrow();
    });

    it("maps WorkItem fields to DTO fields correctly", async () => {
      vi.mocked(mockPort.list).mockResolvedValue({
        items: [SAMPLE_WORK_ITEM],
        nextCursor: undefined,
      });

      const result = await listWorkItems({});
      const dto = result.items[0];

      expect(dto).toBeDefined();
      expect(dto?.id).toBe("task.0001");
      expect(dto?.type).toBe("task");
      expect(dto?.title).toBe("Sample task");
      expect(dto?.status).toBe("needs_implement");
      expect(dto?.priority).toBe(1);
      expect(dto?.rank).toBe(5);
      expect(dto?.estimate).toBe(3);
      expect(dto?.projectId).toBe("proj.test");
      expect(dto?.assignees).toEqual([{ kind: "user", userId: "u1" }]);
      expect(dto?.labels).toEqual(["test", "api"]);
      expect(dto?.revision).toBe(2);
      expect(dto?.deployVerified).toBe(false);
      expect(dto?.createdAt).toBe("2026-01-01");
      expect(dto?.updatedAt).toBe("2026-01-02");
    });

    it("DTO passes schema validation", async () => {
      vi.mocked(mockPort.list).mockResolvedValue({
        items: [SAMPLE_WORK_ITEM],
        nextCursor: undefined,
      });

      const result = await listWorkItems({});
      const dto = result.items[0];
      expect(dto).toBeDefined();
      expect(() => WorkItemDtoSchema.parse(dto)).not.toThrow();
    });

    it("passes filter params to port", async () => {
      vi.mocked(mockPort.list).mockResolvedValue({
        items: [],
        nextCursor: undefined,
      });

      await listWorkItems({
        types: ["task", "bug"],
        statuses: ["needs_implement"],
        text: "search",
        projectId: "proj.test",
        limit: 50,
      });

      expect(mockPort.list).toHaveBeenCalledWith({
        types: ["task", "bug"],
        statuses: ["needs_implement"],
        text: "search",
        projectId: toWorkItemId("proj.test"),
        limit: 50,
      });
    });

    it("omits undefined filter params from port query", async () => {
      vi.mocked(mockPort.list).mockResolvedValue({
        items: [],
        nextCursor: undefined,
      });

      await listWorkItems({});

      expect(mockPort.list).toHaveBeenCalledWith({});
    });

    it("returns empty items for empty result", async () => {
      vi.mocked(mockPort.list).mockResolvedValue({
        items: [],
        nextCursor: undefined,
      });

      const result = await listWorkItems({});
      expect(result.items).toEqual([]);
    });

    it("passes through nextCursor and pageInfo from doltgres", async () => {
      vi.mocked(mockPort.list).mockResolvedValue({
        items: [],
        nextCursor: undefined,
      });
      mockDoltgres.list.mockResolvedValue({
        items: [],
        pageInfo: { endCursor: "cursor-xyz", hasMore: true },
      });

      const result = await listWorkItems({});
      expect(result.pageInfo).toEqual({
        endCursor: "cursor-xyz",
        hasMore: true,
      });
      expect(result.nextCursor).toBe("cursor-xyz");
    });

    it("forwards cursor to doltgres and skips markdown source", async () => {
      mockDoltgres.list.mockResolvedValue({
        items: [],
        pageInfo: { endCursor: null, hasMore: false },
      });

      await listWorkItems({ cursor: "encoded-cursor" });

      expect(mockPort.list).not.toHaveBeenCalled();
      expect(mockDoltgres.list).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: "encoded-cursor" })
      );
    });
  });

  describe("getWorkItem", () => {
    it("returns DTO for existing item", async () => {
      vi.mocked(mockPort.get).mockResolvedValue(SAMPLE_WORK_ITEM);

      const result = await getWorkItem("task.0001");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("task.0001");
      expect(result?.title).toBe("Sample task");
      expect(() => WorkItemDtoSchema.parse(result)).not.toThrow();
    });

    it("returns null for non-existent item", async () => {
      vi.mocked(mockPort.get).mockResolvedValue(null);

      const result = await getWorkItem("task.9999");

      expect(result).toBeNull();
    });

    it("calls port with branded WorkItemId", async () => {
      vi.mocked(mockPort.get).mockResolvedValue(null);

      await getWorkItem("task.0001");

      expect(mockPort.get).toHaveBeenCalledWith(toWorkItemId("task.0001"));
    });
  });
});

const RED_USER: SessionUser = {
  id: "00000000-0000-4000-8000-000000000527",
  walletAddress: null,
  displayName: "Red conformance",
  avatarColor: null,
};
function mutationRequest(body: unknown) {
  return new Request("http://red.test/api/v1/conformance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fixture",
    },
    body: JSON.stringify(body),
  });
}

describe("Red owned mutation composition", () => {
  it("forwards the exact PG lease owner/token without a content lookup", async () => {
    const heartbeat = vi.fn().mockResolvedValue({ active: true });
    const release = vi.fn().mockResolvedValue({ active: false });
    const claim = vi
      .fn()
      .mockResolvedValue({ leaseToken: "returned-pg-token" });
    const get = vi.fn(() => {
      throw new Error("heartbeat must not look up content");
    });
    mockGetContainer.mockReturnValue({
      doltgresWorkItems: { heartbeat, release, claim, get },
    } as never);
    const owner = {
      id: "task.5278",
      principalId: RED_USER.id,
      runId: "red-run",
      leaseToken: "actual-pg-token",
    };
    await heartbeatWorkItem({ ...owner, command: "implement" });
    await releaseWorkItem(owner);
    await claimWorkItem({
      id: owner.id,
      principalId: owner.principalId,
      runId: owner.runId,
      command: "implement",
    });
    expect(heartbeat).toHaveBeenCalledExactlyOnceWith({
      ...owner,
      command: "implement",
    });
    expect(release).toHaveBeenCalledExactlyOnceWith(owner);
    expect(claim).toHaveBeenCalledExactlyOnceWith({
      id: owner.id,
      principalId: owner.principalId,
      runId: owner.runId,
      command: "implement",
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("preserves the work-item unknown receipt instead of turning it into retryable capacity", async () => {
    const unknown = new WorkItemWriteOutcomeUnknownError(
      "red-op",
      "ops/red-op",
      undefined,
      "task.5278"
    );
    const patch = vi.fn().mockRejectedValue(unknown);
    mockGetContainer.mockReturnValue({ doltgresWorkItems: { patch } } as never);
    const caught = await patchWorkItem(
      { id: "task.5278", set: { title: "one intent" } },
      RED_USER
    ).catch((error) => error);
    expect(caught).toBeInstanceOf(WorkItemWriteOutcomeUnknownError);
    expect(caught.receipt).toEqual(unknown.receipt);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  const operations = [
    {
      name: "create",
      method: "create",
      invoke: () =>
        handleCreate(mutationRequest({ message: "one intent" }), RED_USER),
    },
    {
      name: "append",
      method: "appendCommit",
      invoke: () =>
        handleAppendCommit(
          mutationRequest({
            message: "one intent",
            edits: [{ op: "delete", targetRowId: "entry", reason: "reviewed" }],
          }),
          "contrib-red",
          RED_USER
        ),
    },
    {
      name: "merge",
      method: "merge",
      invoke: () => handleMerge(mutationRequest({}), "contrib-red", RED_USER),
    },
    {
      name: "close",
      method: "close",
      invoke: () =>
        handleClose(
          mutationRequest({ reason: "reviewed" }),
          "contrib-red",
          RED_USER
        ),
    },
    {
      name: "EDO",
      method: "createEdoHypothesisContribution",
      invoke: () =>
        handleHypothesize(
          mutationRequest({
            id: "red-hypothesis",
            domain: "red",
            title: "Prediction",
            content: "Evidence",
            evaluateAt: "2030-01-01T00:00:00.000Z",
            sourceType: "agent",
          }),
          RED_USER
        ),
    },
    {
      name: "domain",
      method: "registerDomain",
      invoke: () =>
        handleDomain(mutationRequest({ id: "red", name: "Red" }), RED_USER),
    },
  ];
  const failures = [
    {
      name: "unknown",
      error: () =>
        new KnowledgeWriteOutcomeUnknownError("red-op", "ops/red-op"),
      status: 409,
      body: {
        errorCode: "knowledge_write_outcome_unknown",
        retryable: false,
        operationId: "red-op",
        branch: "ops/red-op",
        commitHash: null,
      },
    },
    {
      name: "conflict",
      error: () => new KnowledgeWriteConflictError("red-entry"),
      status: 409,
      body: {
        errorCode: "knowledge_write_conflict",
        retryable: false,
        entryId: "red-entry",
      },
    },
    {
      name: "scope",
      error: () => new KnowledgeWriteScopeRequiredError(),
      status: 500,
      body: { errorCode: "knowledge_write_scope_required", retryable: false },
    },
    {
      name: "preadmission busy",
      error: () => new KnowledgeBusyError(),
      status: 503,
      body: { retryable: true },
    },
  ];
  for (const operation of operations) {
    for (const failure of failures) {
      it(`${operation.name}: ${failure.name} retains status, lookup and retry policy`, async () => {
        const mutation = vi.fn().mockRejectedValue(failure.error());
        mockGetContainer.mockReturnValue({
          knowledgeContributionService: { [operation.method]: mutation },
          knowledgeStorePort: { [operation.method]: mutation },
          log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as never);
        const response = await operation.invoke();
        expect(response.status).toBe(failure.status);
        expect(await response.json()).toMatchObject(failure.body);
        expect(response.headers.get("Retry-After")).toBe(
          failure.status === 503 ? "2" : null
        );
        expect(mutation).toHaveBeenCalledTimes(1);
      });
    }
  }
});
