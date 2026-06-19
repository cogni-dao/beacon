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

/** Normalized result of a successful link — what the persistence layer stores. */
export interface PlatformLinkResult {
  readonly blob: PlatformCredentialBlob;
  readonly account: PlatformAccount;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
}

/** Fields every connector declares regardless of credential model. */
interface PlatformConnectorBase {
  /** Registry key — matches connections.provider (e.g. "x", "moltbook"). */
  readonly provider: string;
  /** App-review / posting reality for graceful degradation downstream. */
  readonly gating: PlatformGating;
}

/**
 * OAuth 2.0 connector (redirect + code exchange). The generic connect (GET) +
 * callback routes drive this shape: redirect → exchange → fetchAccount.
 * Stateless: the caller carries PKCE state across the redirect.
 */
export interface OAuthPlatformConnector extends PlatformConnectorBase {
  readonly credentialType: "oauth2";
  /** OAuth scopes requested at authorize time. */
  readonly scopes: readonly string[];

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

/**
 * Credential connector (user-supplied secret, no redirect). The generic connect
 * (POST) route drives this shape: the user submits an API key / app-password,
 * the connector validates it against the platform and returns the link result.
 * For platforms whose API is Bearer/API-key, not OAuth (e.g. Moltbook).
 */
export interface CredentialPlatformConnector extends PlatformConnectorBase {
  readonly credentialType: "api_key" | "app_password";

  /**
   * Validate a user-supplied secret against the platform and produce the stored
   * blob + non-secret display account. The single round-trip both proves the
   * secret works and fetches the identity.
   * @throws if the secret is invalid or the platform is unreachable.
   */
  validateAndStore(secret: string): Promise<PlatformLinkResult>;
}

/**
 * Control-plane connector for a single platform provider. The connect route
 * dispatches on `credentialType`: `oauth2` → redirect flow; credential → POST
 * validate flow.
 */
export type PlatformConnectorPort =
  | OAuthPlatformConnector
  | CredentialPlatformConnector;
