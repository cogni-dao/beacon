// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/connect`
 * Purpose: Initiate platform OAuth — build the authorize URL, stash PKCE state in a signed cookie,
 *   and 302 the browser to the provider. Generic across providers via the connector registry.
 * Scope: GET (top-level navigation). Requires an authenticated session.
 * Invariants:
 *   - ENCRYPTION_REQUIRED: fail-fast 500 if CONNECTIONS_ENCRYPTION_KEY is unset — never proceed
 *     toward storing credentials we can't encrypt.
 *   - FAIL_CLOSED: PKCE verifier + state carried only in the signed HttpOnly cookie.
 * Side-effects: cookie set, redirect.
 * Links: docs/spec/platform-connections.md, ../_state-cookie.ts
 * @public
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlatformConnector } from "@/bootstrap/container";
import { getServerSessionUser } from "@/lib/auth/server";
import { serverEnv } from "@/shared/env";
import {
  CONN_STATE_COOKIE,
  CONN_STATE_PATH,
  CONN_STATE_TTL,
  signConnectState,
} from "../_state-cookie";

export const runtime = "nodejs";

function redirectUriFor(req: Request, provider: string): string {
  const base = serverEnv().APP_BASE_URL ?? new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}/api/v1/connections/${provider}/callback`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Never start a flow we can't finish: we must be able to encrypt the result.
  if (!serverEnv().CONNECTIONS_ENCRYPTION_KEY) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const connector = getPlatformConnector(provider);
  if (!connector) {
    return NextResponse.json(
      { error: `Provider not available: ${provider}` },
      { status: 400 }
    );
  }

  const redirectUri = redirectUriFor(req, provider);
  const { url, state, codeVerifier } = connector.buildAuthorizeUrl({
    redirectUri,
  });

  const cookieValue = await signConnectState({
    provider,
    userId: session.id,
    state,
    codeVerifier,
  });

  const cookieStore = await cookies();
  cookieStore.set(CONN_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    // biome-ignore lint/style/noProcessEnv: matches link-intent infra cookie convention
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: CONN_STATE_PATH,
    maxAge: CONN_STATE_TTL,
  });

  return NextResponse.redirect(url);
}
