// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Unit tests for XPlatformConnector pure auth-URL + PKCE logic (no network).
 * Verifies S256 PKCE correctness and authorize-URL parameters — the security-critical
 * surface the connect route depends on.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { XPlatformConnector } from "@/adapters/server/connections/x.connector";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const connector = new XPlatformConnector({
  clientId: "test-client",
  clientSecret: "test-secret",
});
const redirectUri = "https://node.example/api/v1/connections/x/callback";

describe("XPlatformConnector.buildAuthorizeUrl", () => {
  it("emits a valid X authorize URL with required OAuth2 + PKCE params", () => {
    const { url } = connector.buildAuthorizeUrl({ redirectUri });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      "https://twitter.com/i/oauth2/authorize"
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("test-client");
    expect(parsed.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toContain("tweet.write");
    // offline.access is required for X to issue a refresh token.
    expect(parsed.searchParams.get("scope")).toContain("offline.access");
  });

  it("derives code_challenge as base64url(sha256(code_verifier)) [S256]", () => {
    const { url, codeVerifier } = connector.buildAuthorizeUrl({ redirectUri });
    const challenge = new URL(url).searchParams.get("code_challenge");
    const expected = base64url(
      createHash("sha256").update(codeVerifier).digest()
    );
    expect(challenge).toBe(expected);
  });

  it("generates a fresh, high-entropy state + verifier per call", () => {
    const a = connector.buildAuthorizeUrl({ redirectUri });
    const b = connector.buildAuthorizeUrl({ redirectUri });
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    // PKCE verifier must be 43–128 chars per RFC 7636.
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(a.codeVerifier.length).toBeLessThanOrEqual(128);
  });

  it("declares public posting with no external review gate", () => {
    expect(connector.provider).toBe("x");
    expect(connector.credentialType).toBe("oauth2");
    expect(connector.gating.postScope).toBe("public");
    expect(connector.gating.requiresExternalReview).toBe(false);
  });
});
