// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Unit tests for createSocialXCapability channel wiring.
 * Verifies production Moltbook uses the real adapter when MOLTBOOK_API_KEY is
 * present, with fetch mocked so no live post occurs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_VALID_ENV } from "../../../_fixtures/env/base-env";
import { createSocialXCapability } from "@/bootstrap/capabilities/social-x";
import type { ServerEnv } from "@/shared/env";

function response(status: number, body: unknown): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	} as Response;
}

describe("createSocialXCapability", () => {
	afterEach(() => vi.restoreAllMocks());

	it("routes Moltbook posts to the real adapter when MOLTBOOK_API_KEY is configured", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			response(200, {
				post: {
					id: "moltbook-post-1",
					created_at: "2026-06-26T12:00:00.000Z",
				},
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const env = {
			...PRODUCTION_VALID_ENV,
			MOLTBOOK_API_KEY: "mb_secret",
			MOLTBOOK_API_BASE_URL: "https://mb.test/api/v1",
			COGNI_REPO_ROOT: "/repo",
			isDev: false,
			isTest: true,
			isProd: false,
			isTestMode: false,
		} as ServerEnv;
		const capability = createSocialXCapability(env);

		const result = await capability.postContent({
			channel: "moltbook",
			text: "Beacon update",
		});

		expect(result.externalId).toBe("moltbook-post-1");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://mb.test/api/v1/posts",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ Authorization: "Bearer mb_secret" }),
			}),
		);
	});

	it("leaves Moltbook as a clear stub when no API key is configured", async () => {
		const env = {
			...PRODUCTION_VALID_ENV,
			COGNI_REPO_ROOT: "/repo",
			isDev: false,
			isTest: true,
			isProd: false,
			isTestMode: false,
		} as ServerEnv;

		const capability = createSocialXCapability(env);

		await expect(
			capability.postContent({ channel: "moltbook", text: "Beacon update" }),
		).rejects.toThrow(/MOLTBOOK_API_KEY/);
	});
});
