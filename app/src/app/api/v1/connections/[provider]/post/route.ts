// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/post`
 * Purpose: Exercise the per-tenant posting pipeline (resolve connection → post)
 *   against the FAKE "sandbox" platform — proving connect→resolve→post works with
 *   no external send. SANDBOX-ONLY: real platforms post through the growth loop's
 *   approval-gated path, never this ad-hoc route.
 * Invariants:
 *   - SANDBOX_ONLY: any non-sandbox provider is rejected (no real-posting backdoor).
 *   - TENANT_SCOPED: resolves only the caller's own active connection (RLS scope).
 *   - TOKENS_NEVER_LOGGED: the resolved token is used, never logged or returned.
 *   - BROKER_RESOLVES_ALL: credentials come from the broker, never direct decrypt.
 * Side-effects: IO (DB read via broker). The fake poster makes no external call.
 * Links: docs/spec/platform-connections.md, src/ports/sandbox-poster.port.ts
 * @public
 */

import type { UserId } from "@cogni/ids";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/bootstrap/container";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import { getServerSessionUser } from "@/lib/auth/server";
import { makeLogger } from "@/shared/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = makeLogger({ component: "ConnectionsPostRoute" });

const PostBodySchema = z.object({ text: z.string().min(1).max(2000) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ posted: false }, { status: 401 });
  }

  // SANDBOX_ONLY: this route is the fake-posting harness, not a real publisher.
  if (provider !== "sandbox") {
    return NextResponse.json(
      { posted: false, reason: "posting_not_supported_here" },
      { status: 400 }
    );
  }

  const container = getContainer();
  const broker = container.connectionBroker;
  if (!broker) {
    return NextResponse.json(
      { posted: false, reason: "broker_unavailable" },
      { status: 503 }
    );
  }

  let body: { text: string };
  try {
    body = PostBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { posted: false, reason: "text_required" },
      { status: 400 }
    );
  }

  try {
    const billingAccount = await getOrCreateBillingAccountForUser(
      container.accountsForUser(session.id as UserId),
      { userId: session.id }
    );

    const resolved = await broker.resolveActive(billingAccount.id, provider, {
      actorId: session.id,
      tenantId: billingAccount.id,
    });
    if (!resolved) {
      return NextResponse.json(
        { posted: false, reason: "not_linked" },
        { status: 400 }
      );
    }

    const poster = container.sandboxPosterForToken(
      resolved.credentials.accessToken
    );
    const result = await poster.post(body.text);

    return NextResponse.json({ posted: true, result });
  } catch (error) {
    logger.error(
      {
        provider,
        reasonCode: "sandbox_post_failed",
        err: error instanceof Error ? error.message : "unknown",
      },
      "sandbox post failed"
    );
    return NextResponse.json(
      { posted: false, reason: "post_failed" },
      { status: 502 }
    );
  }
}
