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

import type { UserId } from "@cogni/ids";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getContainer, getPlatformConnector } from "@/bootstrap/container";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import { getServerSessionUser } from "@/lib/auth/server";
import { serverEnv } from "@/shared/env";
import { makeLogger } from "@/shared/observability";
import { persistPlatformConnection } from "../_persist";
import {
  CONN_STATE_COOKIE,
  CONN_STATE_PATH,
  CONN_STATE_TTL,
  signConnectState,
} from "../_state-cookie";

export const runtime = "nodejs";

const log = makeLogger({ component: "platform-connect" });

/** Credential connect (POST) body — the tenant's API key / app-password. */
const CredentialConnectBodySchema = z.object({
  apiKey: z.string().min(1).max(4096),
});

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
  // GET is the OAuth redirect flow; credential connectors link via POST.
  if (connector.credentialType !== "oauth2") {
    return NextResponse.json(
      { error: "Provider uses key-based linking — POST your credential" },
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

/**
 * Credential link (POST) — for API-key / app-password connectors (no redirect).
 * The tenant submits their key; the connector validates it against the platform
 * and we persist the encrypted connection. Returns JSON (the UI is a form, not a
 * navigation).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const encKeyHex = serverEnv().CONNECTIONS_ENCRYPTION_KEY;
  if (!encKeyHex) {
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
  // POST is the credential flow; OAuth connectors link via GET redirect.
  if (connector.credentialType === "oauth2") {
    return NextResponse.json(
      { error: "Provider uses OAuth — start the redirect flow with GET" },
      { status: 400 }
    );
  }

  let parsedBody: { apiKey: string };
  try {
    parsedBody = CredentialConnectBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "A non-empty apiKey is required" },
      { status: 400 }
    );
  }

  try {
    // Single round-trip validates the key AND fetches the display identity.
    const link = await connector.validateAndStore(parsedBody.apiKey);

    const container = getContainer();
    const billingAccount = await getOrCreateBillingAccountForUser(
      container.accountsForUser(session.id as UserId),
      { userId: session.id }
    );

    await persistPlatformConnection({
      provider,
      credentialType: connector.credentialType,
      userId: session.id,
      billingAccountId: billingAccount.id,
      link,
      encKeyHex,
    });

    return NextResponse.json({
      connected: true,
      handle: link.account.handle,
    });
  } catch (err) {
    // Coarse-grained: never echo the submitted key or wrapped DB errors.
    const reason =
      err instanceof Error ? err.message.split("\n")[0] : "unknown";
    log.warn({ provider, reason }, "Credential connection link failed");
    return NextResponse.json(
      { error: "Could not link account — check the key and try again" },
      { status: 400 }
    );
  }
}
