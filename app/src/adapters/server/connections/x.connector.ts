// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/connections/x.connector`
 * Purpose: X (Twitter) implementation of PlatformConnectorPort — OAuth 2.0 Authorization Code + PKCE.
 * Scope: Authorize-URL build, code→token exchange (confidential client, Basic auth), /2/users/me
 *   identity fetch, and refresh-token rotation. Confidential client: client_secret never leaves server.
 * Invariants:
 * - PKCE_S256: code_challenge = base64url(sha256(code_verifier)), method S256.
 * - TOKENS_NEVER_LOGGED: no tokens in logs or thrown messages.
 * - OFFLINE_ACCESS: requests offline.access so a refresh_token is issued.
 * Side-effects: IO (HTTPS to X auth + API endpoints).
 * Links: docs/spec/platform-connections.md, src/ports/platform-connector.port.ts
 * @internal
 */

import { createHash, randomBytes } from "node:crypto";
import type {
  PlatformAccount,
  PlatformConnectorPort,
  PlatformCredentialBlob,
  PlatformRefreshResult,
} from "@/ports";

const X_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const X_ME_URL = "https://api.twitter.com/2/users/me";

/** offline.access is required for X to issue a refresh_token. */
const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
] as const;

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface XConnectorConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export class XPlatformConnector implements PlatformConnectorPort {
  readonly provider = "x";
  readonly credentialType = "oauth2";
  readonly scopes = X_SCOPES;
  readonly gating = {
    postScope: "public",
    requiresExternalReview: false,
  } as const;

  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(config: XConnectorConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  /** Basic auth header for the confidential client token endpoint. */
  private basicAuthHeader(): string {
    const raw = `${this.clientId}:${this.clientSecret}`;
    return `Basic ${Buffer.from(raw).toString("base64")}`;
  }

  buildAuthorizeUrl(params: { redirectUri: string }): {
    url: string;
    state: string;
    codeVerifier: string;
  } {
    const state = base64url(randomBytes(32));
    const codeVerifier = base64url(randomBytes(64));
    const codeChallenge = base64url(
      createHash("sha256").update(codeVerifier).digest()
    );

    const url = new URL(X_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("scope", this.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return { url: url.toString(), state, codeVerifier };
  }

  async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{
    blob: PlatformCredentialBlob;
    scopes: readonly string[];
    expiresAt: Date | null;
  }> {
    const res = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: this.basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
        client_id: this.clientId,
      }),
    });

    if (!res.ok) {
      throw new Error(`X token exchange failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    const blob: PlatformCredentialBlob = {
      access_token: data.access_token,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      ...(expiresAt ? { expires_at: expiresAt.toISOString() } : {}),
    };

    return {
      blob,
      scopes: data.scope ? data.scope.split(" ") : this.scopes,
      expiresAt,
    };
  }

  async fetchAccount(accessToken: string): Promise<PlatformAccount> {
    const res = await fetch(X_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`X /users/me failed: ${res.status}`);
    }
    const { data } = (await res.json()) as {
      data: { id: string; username: string; name?: string };
    };
    return {
      externalAccountId: data.id,
      handle: `@${data.username}`,
      displayLabel: data.name ? `${data.name} (@${data.username})` : `@${data.username}`,
    };
  }

  async refresh(refreshToken: string): Promise<PlatformRefreshResult> {
    const res = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: this.basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.clientId,
      }),
    });

    if (!res.ok) {
      throw new Error(`X token refresh failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      access: data.access_token,
      // X rotates refresh tokens; fall back to the prior one if absent.
      refresh: data.refresh_token ?? refreshToken,
      expires: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
  }
}
