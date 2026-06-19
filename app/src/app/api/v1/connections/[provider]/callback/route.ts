// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/callback`
 * Purpose: OAuth callback — verify signed state, exchange code, fetch account identity, encrypt and
 *   store the connection (revoking any prior active one for the same handle). Generic per provider.
 * Scope: GET (browser redirect from the provider). Requires the matching signed state cookie.
 * Invariants:
 *   - FAIL_CLOSED: reject on missing/expired/tampered cookie, provider/user/state mismatch.
 *   - ENCRYPTED_AT_REST: tokens stored via AEAD with AAD binding {billing_account_id, connection_id, provider}.
 *   - TOKENS_NEVER_LOGGED: no tokens in logs or responses (errors are coarse-grained).
 *   - TENANT_SCOPED: connection belongs to the authenticated user's billing account.
 * Side-effects: IO (token exchange, identity fetch, DB insert), cookie clear, redirect.
 * Links: docs/spec/platform-connections.md, ../_state-cookie.ts
 * @public
 */

import { timingSafeEqual } from "node:crypto";
import type { UserId } from "@cogni/ids";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getContainer, getPlatformConnector } from "@/bootstrap/container";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import { getServerSessionUser } from "@/lib/auth/server";
import { serverEnv } from "@/shared/env";
import { makeLogger } from "@/shared/observability";
import { persistPlatformConnection } from "../_persist";
import {
  CONN_STATE_COOKIE,
  CONN_STATE_PATH,
  verifyConnectState,
} from "../_state-cookie";

export const runtime = "nodejs";

const log = makeLogger({ component: "platform-connect-callback" });

function fail(req: Request, provider: string, reason: string): NextResponse {
  log.warn({ provider, reason }, "Platform connect callback rejected");
  const base = serverEnv().APP_BASE_URL ?? new URL(req.url).origin;
  const res = NextResponse.redirect(`${base.replace(/\/$/, "")}/profile?error=connect_failed`);
  res.cookies.delete({ name: CONN_STATE_COOKIE, path: CONN_STATE_PATH });
  return res;
}

function timingSafeStrEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function redirectUriFor(req: Request, provider: string): string {
  const base = serverEnv().APP_BASE_URL ?? new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}/api/v1/connections/${provider}/callback`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  if (url.searchParams.get("error")) {
    return fail(req, provider, "provider_denied");
  }
  if (!code || !returnedState) {
    return fail(req, provider, "missing_code_or_state");
  }

  // Fail-closed state verification.
  const cookieStore = await cookies();
  const stored = await verifyConnectState(
    cookieStore.get(CONN_STATE_COOKIE)?.value
  );
  if (!stored) return fail(req, provider, "no_valid_state");
  if (stored.provider !== provider) return fail(req, provider, "provider_mismatch");
  if (!timingSafeStrEq(stored.state, returnedState)) {
    return fail(req, provider, "state_mismatch");
  }

  // Re-validate the session and bind it to the cookie's user.
  const session = await getServerSessionUser();
  if (!session || session.id !== stored.userId) {
    return fail(req, provider, "session_mismatch");
  }

  const encKeyHex = serverEnv().CONNECTIONS_ENCRYPTION_KEY;
  if (!encKeyHex) return fail(req, provider, "encryption_unconfigured");

  const connector = getPlatformConnector(provider);
  if (!connector) return fail(req, provider, "provider_unavailable");
  // This route is the OAuth redirect flow; credential connectors link via
  // POST /api/v1/connections/[provider]/connect instead.
  if (connector.credentialType !== "oauth2") {
    return fail(req, provider, "not_oauth_provider");
  }

  // Exchange + identity fetch (network IO).
  let blob: Awaited<ReturnType<typeof connector.exchangeCode>>["blob"];
  let scopes: readonly string[];
  let expiresAt: Date | null;
  let account: Awaited<ReturnType<typeof connector.fetchAccount>>;
  try {
    const exchanged = await connector.exchangeCode({
      code,
      codeVerifier: stored.codeVerifier,
      redirectUri: redirectUriFor(req, provider),
    });
    blob = exchanged.blob;
    scopes = exchanged.scopes;
    expiresAt = exchanged.expiresAt;
    account = await connector.fetchAccount(blob.access_token);
  } catch (err) {
    // Surface the provider's actual OAuth error (twitter-api-v2 ApiResponseError
    // carries .code = HTTP status and .data = { error, error_description }).
    // These describe the rejection, never our tokens.
    const e = err as { code?: number; data?: unknown; message?: string };
    log.error(
      {
        provider,
        error: err instanceof Error ? err.message : String(err),
        providerStatus: e?.code,
        providerError: e?.data,
      },
      "Platform OAuth exchange failed"
    );
    return fail(req, provider, "exchange_failed");
  }

  // Resolve billing account (tenant).
  const container = getContainer();
  const accountService = container.accountsForUser(session.id as UserId);
  const billingAccount = await getOrCreateBillingAccountForUser(accountService, {
    userId: session.id,
  });

  // Encrypt + store via the shared persistence path (one storage path for OAuth
  // and credential connectors alike).
  let connectionId: string;
  try {
    ({ connectionId } = await persistPlatformConnection({
      provider,
      credentialType: connector.credentialType,
      userId: session.id,
      billingAccountId: billingAccount.id,
      link: { blob, account, scopes, expiresAt },
      encKeyHex,
    }));
  } catch (err) {
    // Log the root cause only — never the Drizzle wrapper (dumps encrypted blob).
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error
          ? err.message.split("\n")[0]
          : String(err);
    log.error({ provider, error: cause }, "Failed to store platform connection");
    return fail(req, provider, "db_store_failed");
  }

  log.info(
    { provider, connectionId, handle: account.handle },
    "Platform connection stored"
  );

  const base = serverEnv().APP_BASE_URL ?? url.origin;
  const res = NextResponse.redirect(
    `${base.replace(/\/$/, "")}/profile?connected=${provider}`
  );
  res.cookies.delete({ name: CONN_STATE_COOKIE, path: CONN_STATE_PATH });
  return res;
}
