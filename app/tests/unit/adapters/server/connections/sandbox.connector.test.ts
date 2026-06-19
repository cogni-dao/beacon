// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/** Unit tests for SandboxPlatformConnector — deterministic, no network. */

import { describe, expect, it } from "vitest";
import { SandboxPlatformConnector } from "@/adapters/server/connections/sandbox.connector";

describe("SandboxPlatformConnector.validateAndStore", () => {
  const connector = new SandboxPlatformConnector();

  it("links deterministically with no network call", async () => {
    const r = await connector.validateAndStore("alice");
    expect(r.account).toEqual({
      externalAccountId: "sandbox-alice",
      handle: "@alice",
      displayLabel: "Sandbox (alice)",
    });
    expect(r.blob.access_token).toBe("alice");
    expect(r.scopes).toEqual([]);
    expect(r.expiresAt).toBeNull();
  });

  it("sanitizes a messy label to a safe handle", async () => {
    const r = await connector.validateAndStore("  bad/name!! ");
    expect(r.account.handle).toBe("@badname");
    expect(r.account.externalAccountId).toBe("sandbox-badname");
  });

  it("falls back to 'sandbox' when the label has no usable chars", async () => {
    const r = await connector.validateAndStore("!!!");
    expect(r.account.handle).toBe("@sandbox");
  });

  it("declares api_key credentialType + public gating", () => {
    expect(connector.provider).toBe("sandbox");
    expect(connector.credentialType).toBe("api_key");
    expect(connector.gating.postScope).toBe("public");
    expect(connector.gating.requiresExternalReview).toBe(false);
  });
});
