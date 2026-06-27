// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Unit tests for MoltbookSocialAdapter (no network).
 * Mocks global fetch and verifies Bearer auth, v1 post body shape, verification
 * failure surfacing, and best-effort metric reads.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

import {
	DEFAULT_MOLTBOOK_API_BASE_URL,
	MoltbookSocialAdapter,
	MoltbookVerificationRequiredError,
} from "@/adapters/server/social/moltbook.adapter";

function response(status: number, body: unknown): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	} as Response;
}

describe("MoltbookSocialAdapter", () => {
	afterEach(() => vi.restoreAllMocks());

	it("posts text to /posts with Bearer auth and Moltbook's text-post body", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				response(200, {
					success: true,
					post: {
						id: "post-1",
						created_at: "2026-06-26T12:00:00.000Z",
					},
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		const adapter = new MoltbookSocialAdapter({ accessToken: "mb_secret" });
		const result = await adapter.postContent({
			channel: "moltbook",
			text: "Hook line\nBody line",
			moltbook: {
				submoltName: "general",
				title: "Hook line",
				content: "Body line",
				type: "text",
			},
			idempotencyKey: "post-key",
		});

		expect(result).toEqual({
			externalId: "post-1",
			url: "https://www.moltbook.com/post/post-1",
			postedAt: "2026-06-26T12:00:00.000Z",
		});

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${DEFAULT_MOLTBOOK_API_BASE_URL}/posts`);
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer mb_secret",
		);
		expect(JSON.parse(String(init.body))).toEqual({
			submolt_name: "general",
			title: "Hook line",
			content: "Body line",
			type: "text",
		});
	});

	it("requires callers to provide the explicit Moltbook payload", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const adapter = new MoltbookSocialAdapter({ accessToken: "mb_secret" });

		await expect(
			adapter.postContent({ channel: "moltbook", text: "hello" }),
		).rejects.toThrow(/title|content|payload|Required/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("surfaces verification challenges as explicit adapter failures", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				response(200, {
					success: false,
					verification_required: true,
					verification: { kind: "challenge" },
				}),
			),
		);

		const adapter = new MoltbookSocialAdapter({ accessToken: "mb_secret" });

		await expect(
			adapter.postContent({
				channel: "moltbook",
				text: "hello",
				moltbook: {
					submoltName: "general",
					title: "hello",
					content: "hello",
					type: "text",
				},
			}),
		).rejects.toBeInstanceOf(MoltbookVerificationRequiredError);
	});

	it("maps post engagement and skips missing ids", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				response(200, {
					post: {
						id: "post-1",
						upvotes: 8,
						downvotes: 1,
					},
				}),
			)
			.mockResolvedValueOnce(response(200, { comments: [{}, {}] }))
			.mockResolvedValueOnce(response(404, { error: "not found" }));
		vi.stubGlobal("fetch", fetchMock);

		const adapter = new MoltbookSocialAdapter({
			accessToken: "mb_secret",
			apiBaseUrl: "https://mb.test/api/v1",
		});
		const result = await adapter.readMetrics(["post-1", "missing"]);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			externalId: "post-1",
			channel: "moltbook",
			likes: 8,
			reposts: 0,
			replies: 2,
		});
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"https://mb.test/api/v1/posts/post-1",
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer mb_secret" }),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"https://mb.test/api/v1/posts/post-1/comments?sort=best&limit=100",
			expect.any(Object),
		);
	});

	it("does not echo secrets or post bodies in HTTP errors", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500, {})));
		const adapter = new MoltbookSocialAdapter({ accessToken: "mb_secret" });

		await expect(
			adapter.postContent({
				channel: "moltbook",
				text: "sensitive draft",
				moltbook: {
					submoltName: "general",
					title: "Sensitive",
					content: "sensitive draft",
					type: "text",
				},
			}),
		).rejects.toThrow("HTTP 500");
		await expect(
			adapter.postContent({
				channel: "moltbook",
				text: "sensitive draft",
				moltbook: {
					submoltName: "general",
					title: "Sensitive",
					content: "sensitive draft",
					type: "text",
				},
			}),
		).rejects.not.toThrow(/mb_secret|sensitive draft/);
	});
});
