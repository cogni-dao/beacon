// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/platform-connector.port`
 * Purpose: Control-plane port every social/content platform must implement to be linkable.
 * Scope: OAuth authorize-URL construction, code→token exchange, account identity fetch, and token
 *   refresh. Provider-agnostic — the generic connect/callback routes drive any registered connector.
 *   Does NOT cover the data plane (publish/metrics) — that is a separate PlatformClient used by tools.
 * Invariants:
 * - ONE_GATE: No platform ships a connect flow without implementing this shape.
 * - PKCE_STATE_OPAQUE: state + codeVerifier are carried across the redirect by the caller (signed
 *   cookie), never persisted here. The connector is stateless.
 * - TOKENS_NEVER_LOGGED: Credential blobs/tokens must not appear in logs or error messages.
 * - DISPLAY_IS_NONSECRET: fetchAccount returns only non-secret identity for display columns.
 * Side-effects: none (interface only)
 * Links: docs/spec/platform-connections.md, src/ports/connection-broker.port.ts
 * @public
 */

/** Credential blob persisted (AEAD-encrypted) in the connections table. Provider-agnostic. */
export interface PlatformCredentialBlob {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly account_id?: string;
  /** ISO-8601 expiry; absent for non-expiring credentials. */
  readonly expires_at?: string;
}

/** Result of a token refresh — shape matches the broker's TokenRefreshFn contract. */
export interface PlatformRefreshResult {
  readonly access: string;
  readonly refresh: string;
  /** Epoch millis when the new access token expires. */
  readonly expires: number;
  readonly accountId?: string;
}

/** Non-secret platform account identity — written to connections display columns. */
export interface PlatformAccount {
  readonly externalAccountId: string;
  readonly handle: string;
  readonly displayLabel: string;
}

/** Honest declaration of a platform's app-review / posting reality. */
export interface PlatformGating {
  /** Whether public posting is available, gated to self-only/draft, or unavailable. */
  readonly postScope: "public" | "self_only" | "unavailable";
  /** Whether external platform app review is required before posting works. */
  readonly requiresExternalReview: boolean;
  /** Some platforms (Instagram) require a business/creator account. */
  readonly accountKind?: "business_required";
}

/**
 * Control-plane connector for a single platform provider.
 * Stateless: the caller carries PKCE state across the OAuth redirect.
 */
export interface PlatformConnectorPort {
  /** Registry key — matches connections.provider (e.g. "x"). */
  readonly provider: string;
  /** Credential type stored on the connection (e.g. "oauth2"). */
  readonly credentialType: string;
  /** OAuth scopes requested at authorize time. */
  readonly scopes: readonly string[];
  /** App-review / posting reality for graceful degradation downstream. */
  readonly gating: PlatformGating;

  /**
   * Build the provider authorize URL plus the PKCE/state the caller must carry
   * across the redirect (in a signed cookie) and echo back at the callback.
   */
  buildAuthorizeUrl(params: { redirectUri: string }): {
    url: string;
    state: string;
    codeVerifier: string;
  };

  /**
   * Exchange an authorization code for tokens.
   * @throws if the exchange fails (network, invalid code, provider error).
   */
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{
    blob: PlatformCredentialBlob;
    scopes: readonly string[];
    expiresAt: Date | null;
  }>;

  /** Fetch the non-secret account identity for display columns. */
  fetchAccount(accessToken: string): Promise<PlatformAccount>;

  /**
   * Refresh an access token. Wired into the connection broker's refreshFns[provider].
   * @throws if refresh fails.
   */
  refresh(refreshToken: string): Promise<PlatformRefreshResult>;
}
