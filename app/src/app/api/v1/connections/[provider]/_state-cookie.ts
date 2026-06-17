// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/_state-cookie`
 * Purpose: Sign/verify the short-lived OAuth state carried across the connect→callback redirect.
 * Scope: Mirrors the link_intent cookie pattern (signed JWT via next-auth/jwt). Carries
 *   {provider, userId, state, codeVerifier} tamper-proof for 5 minutes. Not a route (leading _).
 * Invariants:
 * - FAIL_CLOSED: callback rejects when the cookie is missing, expired, tampered, or state-mismatched.
 * - PKCE_VERIFIER_SECRET: the code_verifier lives only in this HttpOnly cookie, never client-readable.
 * Side-effects: cookie read/write (caller-driven).
 * Links: src/app/api/auth/link/[provider]/route.ts
 * @internal
 */

import { decode, encode } from "next-auth/jwt";
import { authSecret } from "@/auth";

export const CONN_STATE_COOKIE = "conn_oauth_state";
const CONN_STATE_SALT = "platform-connect";
export const CONN_STATE_TTL = 5 * 60; // 5 minutes
/** Scope the cookie to the connections API surface. */
export const CONN_STATE_PATH = "/api/v1/connections";

export interface ConnectState {
  provider: string;
  userId: string;
  state: string;
  codeVerifier: string;
}

export async function signConnectState(payload: ConnectState): Promise<string> {
  return encode({
    token: { ...payload, purpose: "platform_connect" },
    secret: authSecret,
    salt: CONN_STATE_SALT,
    maxAge: CONN_STATE_TTL,
  });
}

/** Returns the verified payload, or null if missing/expired/tampered. */
export async function verifyConnectState(
  cookieValue: string | undefined
): Promise<ConnectState | null> {
  if (!cookieValue) return null;
  try {
    const token = await decode({
      token: cookieValue,
      secret: authSecret,
      salt: CONN_STATE_SALT,
    });
    if (!token || token.purpose !== "platform_connect") return null;
    const { provider, userId, state, codeVerifier } = token as Record<
      string,
      unknown
    >;
    if (
      typeof provider !== "string" ||
      typeof userId !== "string" ||
      typeof state !== "string" ||
      typeof codeVerifier !== "string"
    ) {
      return null;
    }
    return { provider, userId, state, codeVerifier };
  } catch {
    return null;
  }
}
