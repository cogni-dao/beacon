// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Unit tests for MoltbookPlatformConnector.validateAndStore (no network).
 * Mocks global fetch. Verifies the single GET /agents/me round-trip validates the
 * key, maps the profile, tolerates envelopes, and never echoes the key on failure.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MoltbookPlatformConnector } from "@/adapters/server/connections/moltbook.connector";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("MoltbookPlatformConnector.validateAndStore", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates the key via GET /agents/me (Bearer) and maps the profile", async () => {
    const fetchMock = mockFetch(200, { id: 42, name: "beacon_bot", karma: 17 });
    vi.stubGlobal("fetch", fetchMock);

    const connector = new MoltbookPlatformConnector({
      apiBaseUrl: "https://mb.test/api/v1",
    });
    const res = await connector.validateAndStore("mb_secret");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mb.test/api/v1/agents/me");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer mb_secret"
    );
    expect(res.account).toEqual({
      externalAccountId: "42",
      handle: "@beacon_bot",
      displayLabel: "beacon_bot (17 karma)",
    });
    expect(res.blob).toEqual({
      access_token: "mb_secret",
      account_id: "42",
    });
    expect(res.scopes).toEqual([]);
    expect(res.expiresAt).toBeNull();
  });

  it("throws on an invalid key (401) without echoing the key", async () => {
    vi.stubGlobal("fetch", mockFetch(401, { message: "No API key provided" }));
    const connector = new MoltbookPlatformConnector();

    await expect(connector.validateAndStore("super-secret")).rejects.toThrow(
      /HTTP 401/
    );
    await expect(
      connector.validateAndStore("super-secret")
    ).rejects.not.toThrow(/super-secret/);
  });

  it("unwraps an {agent} envelope and falls back to name when id is absent", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { agent: { name: "solo" } }));
    const connector = new MoltbookPlatformConnector();

    const res = await connector.validateAndStore("k");
    expect(res.account.externalAccountId).toBe("solo");
    expect(res.account.handle).toBe("@solo");
    expect(res.account.displayLabel).toBe("solo");
  });

  it("rejects a response missing the agent name", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { id: 1 }));
    const connector = new MoltbookPlatformConnector();

    await expect(connector.validateAndStore("k")).rejects.toThrow(
      /expected shape/
    );
  });

  it("rejects an empty key before any network call", async () => {
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal("fetch", fetchMock);
    const connector = new MoltbookPlatformConnector();

    await expect(connector.validateAndStore("   ")).rejects.toThrow(/required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("declares api_key credentialType and public gating", () => {
    const connector = new MoltbookPlatformConnector();
    expect(connector.provider).toBe("moltbook");
    expect(connector.credentialType).toBe("api_key");
    expect(connector.gating.postScope).toBe("public");
    expect(connector.gating.requiresExternalReview).toBe(false);
  });
});
