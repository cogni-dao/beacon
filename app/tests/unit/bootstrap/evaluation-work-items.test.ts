// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Consumer compatibility: PostgreSQL receipts are separate from content. No live SQL proof. */
import { describe, expect, it, vi } from "vitest";
import {
  toWorkItemId,
  type WorkItemLeasePort,
  type WorkItemsContentPort,
} from "@cogni/work-items";
import { composeEvaluationWorkItems } from "@/bootstrap/evaluation-work-items";
import {
  workItemsClaimOperation,
  workItemsHeartbeatOperation,
  workItemsReleaseOperation,
} from "../../../../packages/node-contracts/src/work.items.coordination.v1.contract";

const id = toWorkItemId("task.0001");
const receipt = {
  id,
  runId: "run-a",
  leaseToken: "00000000-0000-4000-a000-000000000001",
  claimedAt: "2026-11-26T00:00:00Z",
  expiresAt: "2026-11-26T00:05:00Z",
  lastCommand: "implement",
  active: true,
};
function fixture() {
  const row = {
    id,
    revision: 8,
    title: "Canonical content",
    status: "needs_implement",
  };
  const content = {
    get: vi.fn().mockResolvedValue(row),
    list: vi
      .fn()
      .mockResolvedValue({
        items: [row],
        pageInfo: { endCursor: null, hasMore: false },
      }),
    patch: vi.fn().mockResolvedValue(row),
  };
  const leases = {
    claim: vi.fn().mockResolvedValue(receipt),
    heartbeat: vi.fn().mockResolvedValue(receipt),
    release: vi.fn().mockResolvedValue({ ...receipt, active: false }),
    getMany: vi.fn().mockResolvedValue(new Map([[id, receipt]])),
  };
  return {
    content,
    leases,
    store: composeEvaluationWorkItems(
      content as unknown as WorkItemsContentPort,
      leases as WorkItemLeasePort,
    ),
  };
}
describe("released PostgreSQL lease composition", () => {
  it("overlays a content page with exactly one bounded lease read", async () => {
    const { content, leases, store } = fixture();
    const page = await store.list({ limit: 10 });
    expect(content.list).toHaveBeenCalledWith({ limit: 10 });
    expect(leases.getMany).toHaveBeenCalledExactlyOnceWith([id]);
    expect(page.items[0]).toMatchObject({
      revision: 8,
      title: "Canonical content",
      claimedByRun: "run-a",
    });
  });
  it("forwards principal, run and token and returns receipts; renew/release do not read Dolt", async () => {
    const { content, leases, store } = fixture();
    const owner = { id, runId: "run-a", principalId: "actual-owner" };
    expect(await store.claim({ ...owner, command: "implement" })).toEqual(
      receipt,
    );
    expect(content.get).toHaveBeenCalledExactlyOnceWith(id);
    content.get.mockClear();
    const token = { ...owner, leaseToken: receipt.leaseToken };
    expect(await store.heartbeat(token)).toEqual(receipt);
    expect(await store.release(token)).toMatchObject({ active: false });
    expect(leases.heartbeat).toHaveBeenCalledWith(token);
    expect(leases.release).toHaveBeenCalledWith(token);
    expect(content.get).not.toHaveBeenCalled();
  });
  it("wire schemas require tokens on renewal/release and parse lease receipts", () => {
    expect(workItemsClaimOperation.output.parse(receipt)).toEqual(receipt);
    const owner = { id, runId: "run-a" };
    expect(workItemsHeartbeatOperation.input.safeParse(owner).success).toBe(
      false,
    );
    expect(workItemsReleaseOperation.input.safeParse(owner).success).toBe(
      false,
    );
    expect(
      workItemsReleaseOperation.input.parse({
        ...owner,
        leaseToken: receipt.leaseToken,
      }),
    ).toMatchObject({ leaseToken: receipt.leaseToken });
  });
  it("preserves unknown content outcomes without retry or lease mutation", async () => {
    const { content, leases, store } = fixture();
    const failure = new Error("uncertain native outcome");
    content.patch.mockRejectedValue(failure);
    await expect(
      store.patch(
        { id, reason: "Test uncertain result", set: {} },
        { actor: "actual-owner" },
      ),
    ).rejects.toBe(failure);
    expect(content.patch).toHaveBeenCalledTimes(1);
    expect(leases.claim).not.toHaveBeenCalled();
  });
});
