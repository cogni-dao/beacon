// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/connections/x.connector`
 * Purpose: X (Twitter) implementation of PlatformConnectorPort — OAuth 2.0 Authorization Code + PKCE.
 * Scope: Authorize-URL build, code→token exchange, /2/users/me identity fetch, and
 *   refresh-token rotation through twitter-api-v2. Confidential client: client_secret never leaves server.
 * Invariants:
 * - PKCE_S256: code_challenge = base64url(sha256(code_verifier)), method S256.
 * - TOKENS_NEVER_LOGGED: no tokens in logs or thrown messages.
 * - OFFLINE_ACCESS: requests offline.access so a refresh_token is issued.
 * Side-effects: IO (HTTPS to X auth + API endpoints).
 * Links: docs/spec/platform-connections.md, src/ports/platform-connector.port.ts
 * @internal
 */

import type {
  PlatformAccount,
  PlatformConnectorPort,
  PlatformCredentialBlob,
  PlatformRefreshResult,
} from "@/ports";
import { TwitterApi, type TOAuth2Scope } from "twitter-api-v2";

/** offline.access is required for X to issue a refresh_token. */
const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
] as const satisfies readonly TOAuth2Scope[];

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

  private requestClient(): TwitterApi {
    return new TwitterApi({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });
  }

  buildAuthorizeUrl(params: { redirectUri: string }): {
    url: string;
    state: string;
    codeVerifier: string;
  } {
    const { url, state, codeVerifier } =
      this.requestClient().generateOAuth2AuthLink(params.redirectUri, {
        scope: [...this.scopes],
      });
    return { url, state, codeVerifier };
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
    const result = await this.requestClient().loginWithOAuth2({
      code: params.code,
      codeVerifier: params.codeVerifier,
      redirectUri: params.redirectUri,
    });
    const expiresAt = result.expiresIn
      ? new Date(Date.now() + result.expiresIn * 1000)
      : null;

    const blob: PlatformCredentialBlob = {
      access_token: result.accessToken,
      ...(result.refreshToken ? { refresh_token: result.refreshToken } : {}),
      ...(expiresAt ? { expires_at: expiresAt.toISOString() } : {}),
    };

    return {
      blob,
      scopes: result.scope.length > 0 ? result.scope : this.scopes,
      expiresAt,
    };
  }

  async fetchAccount(accessToken: string): Promise<PlatformAccount> {
    const { data } = await new TwitterApi(accessToken).v2.me();
    return {
      externalAccountId: data.id,
      handle: `@${data.username}`,
      displayLabel: data.name ? `${data.name} (@${data.username})` : `@${data.username}`,
    };
  }

  async refresh(refreshToken: string): Promise<PlatformRefreshResult> {
    const result = await this.requestClient().refreshOAuth2Token(refreshToken);

    return {
      access: result.accessToken,
      // X rotates refresh tokens; fall back to the prior one if absent.
      refresh: result.refreshToken ?? refreshToken,
      expires: Date.now() + (result.expiresIn ?? 7200) * 1000,
    };
  }
}
