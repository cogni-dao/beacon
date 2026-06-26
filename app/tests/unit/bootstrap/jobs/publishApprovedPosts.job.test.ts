// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `tests/unit/bootstrap/jobs/publishApprovedPosts.job`
 * Purpose: Unit coverage for the Moltbook POST-stage job wiring.
 * Scope: Fakes DB, advisory lock, broker, and Moltbook adapter. Does not hit network.
 * Invariants: SINGLE_WRITER, BROKER_RESOLVES_ALL, APPROVED_ONLY update, PROPENSITY_LOGGED.
 * Links: app/src/bootstrap/jobs/publishApprovedPosts.job.ts
 * @internal
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	logInfo: vi.fn(),
}));

vi.mock("@/bootstrap/container", () => ({
	getContainer: () => ({
		connectionBroker: undefined,
		log: { info: mocks.logInfo },
	}),
}));

import { runPublishApprovedPostsJob } from "@/bootstrap/jobs/publishApprovedPosts.job";

function makeReservedConnection(acquired: boolean) {
	const release = vi.fn();
	const reservedConn = Object.assign(
		vi.fn(async (strings: TemplateStringsArray) => {
			const sql = strings.join("");
			if (sql.includes("pg_try_advisory_lock")) return [{ acquired }];
			return [{ released: true }];
		}),
		{ release },
	);
	return reservedConn;
}

function makeDb(rows: unknown[], acquired = true) {
	const reservedConn = makeReservedConnection(acquired);
	const updateSet = vi.fn();
	const insertValues = vi.fn();
	const selectLimit = vi.fn(async () => rows);
	const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
		const tx = {
			update: vi.fn(() => ({
				set: (value: unknown) => {
					updateSet(value);
					return {
						where: () => ({
							returning: async () => [{ id: "post-1" }],
						}),
					};
				},
			})),
			insert: vi.fn(() => ({
				values: (value: unknown) => {
					insertValues(value);
					return Promise.resolve();
				},
			})),
		};
		return cb(tx);
	});

	const db = {
		$client: { reserve: vi.fn(async () => reservedConn) },
		select: vi.fn(() => ({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						orderBy: () => ({
							limit: selectLimit,
						}),
					}),
				}),
			}),
		})),
		transaction,
		update: vi.fn(() => ({
			set: (value: unknown) => {
				updateSet(value);
				return { where: async () => undefined };
			},
		})),
	};

	return { db, insertValues, reservedConn, selectLimit, transaction, updateSet };
}

describe("runPublishApprovedPostsJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("skips without touching the queue when another publisher holds the advisory lock", async () => {
		const { db, selectLimit, reservedConn } = makeDb([], false);
		const broker = { resolveActive: vi.fn() };
		const makeMoltbookAdapter = vi.fn();

		const summary = await runPublishApprovedPostsJob({
			db: db as never,
			broker: broker as never,
			makeMoltbookAdapter: makeMoltbookAdapter as never,
			scope: { accountId: "acct-1", campaignId: "campaign-1" },
		});

		expect(summary).toEqual({
			considered: 0,
			published: 0,
			skippedNoConnection: 0,
			skippedNotEligible: 0,
			failed: 0,
		});
		expect(selectLimit).not.toHaveBeenCalled();
		expect(broker.resolveActive).not.toHaveBeenCalled();
		expect(makeMoltbookAdapter).not.toHaveBeenCalled();
		expect(reservedConn.release).toHaveBeenCalledTimes(1);
	});

	it("publishes one approved Moltbook row through broker credentials and logs the decision", async () => {
		const { db, insertValues, reservedConn, transaction, updateSet } = makeDb([
			{
				id: "post-1",
				accountId: "acct-1",
				campaignId: "campaign-1",
				text: "Beacon update",
				score: 0.91,
				ownerUserId: "user-1",
			},
		]);
		const broker = {
			resolveActive: vi.fn(async () => ({
				connectionId: "conn-1",
				provider: "moltbook",
				credentialType: "api_key",
				credentials: { accessToken: "tenant-moltbook-token" },
				expiresAt: null,
				scopes: [],
			})),
		};
		const postContent = vi.fn(async () => ({
			externalId: "moltbook-post-1",
			postedAt: "2026-06-26T12:00:00.000Z",
		}));
		const makeMoltbookAdapter = vi.fn(() => ({ postContent, readMetrics: vi.fn() }));

		const summary = await runPublishApprovedPostsJob({
			db: db as never,
			broker: broker as never,
			makeMoltbookAdapter: makeMoltbookAdapter as never,
			scope: { accountId: "acct-1", campaignId: "campaign-1" },
		});

		expect(summary).toEqual({
			considered: 1,
			published: 1,
			skippedNoConnection: 0,
			skippedNotEligible: 0,
			failed: 0,
		});
		expect(broker.resolveActive).toHaveBeenCalledWith("acct-1", "moltbook", {
			actorId: "user-1",
			tenantId: "acct-1",
		});
		expect(makeMoltbookAdapter).toHaveBeenCalledWith("tenant-moltbook-token");
		expect(postContent).toHaveBeenCalledWith({
			channel: "moltbook",
			text: "Beacon update",
			idempotencyKey: "post-1",
		});
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "posted",
				externalPostId: "moltbook-post-1",
			}),
		);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				accountId: "acct-1",
				campaignId: "campaign-1",
				postId: "post-1",
				action: "posted",
				score: 0.91,
				rank: 1,
				reason: "approved_queue_highest_score",
			}),
		);
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(reservedConn).toHaveBeenCalledWith(
			expect.arrayContaining(["SELECT pg_advisory_unlock(hashtext('growth_publish_approved'))"]),
		);
		expect(reservedConn.release).toHaveBeenCalledTimes(1);
	});
});
