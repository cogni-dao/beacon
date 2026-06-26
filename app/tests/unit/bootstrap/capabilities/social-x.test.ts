// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Unit tests for createSocialXCapability channel wiring.
 * Verifies production Moltbook remains tenant-connection-only on the container
 * capability path; real posting is constructed by the publish job from broker
 * credentials.
 */

import { describe, expect, it } from "vitest";

import { PRODUCTION_VALID_ENV } from "../../../_fixtures/env/base-env";
import { createSocialXCapability } from "@/bootstrap/capabilities/social-x";
import type { ServerEnv } from "@/shared/env";

describe("createSocialXCapability", () => {
	it("leaves Moltbook as a tenant-connection-only stub in production wiring", async () => {
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
		).rejects.toThrow(/tenant-linked connections/);
	});
});
