// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/ops/growth/metrics-ingest`
 * Purpose: Internal operations endpoint that triggers the beacon growth-loop
 *   metrics-ingest job (reads engagement for recent broadcasts, appends `post_metrics`).
 * Scope: Auth-protected POST endpoint for deploy/cron automation. Delegates to the
 *   ingest job; does not implement ingest logic.
 * Invariants:
 *   - INTERNAL_OPS_AUTH: Requires Bearer INTERNAL_OPS_TOKEN (timing-safe compare)
 *   - JOB_DELEGATION_ONLY: Uses runIngestPostMetricsJob() for all orchestration
 *   - SOLE_POST_METRICS_WRITER: the delegated job is the only `post_metrics` writer
 * Side-effects: IO (HTTP request/response, DB reads/writes + social reads via job)
 * Links: docs/spec/beacon-growth-loop-v0.md §5
 * @internal
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { runIngestPostMetricsJob } from "@/bootstrap/jobs/ingestPostMetrics.job";
import { serverEnv } from "@/shared/env";
import { EVENT_NAMES, logEvent } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTH_HEADER_LENGTH = 512;
const MAX_TOKEN_LENGTH = 256;

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (authHeader.length > MAX_AUTH_HEADER_LENGTH) return null;

  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;

  const token = trimmed.slice(7).trim();
  if (token.length > MAX_TOKEN_LENGTH) return null;

  return token;
}

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "growth.metrics_ingest.internal", auth: { mode: "none" } },
  async (ctx, request) => {
    const env = serverEnv();

    const configuredToken = env.INTERNAL_OPS_TOKEN;
    if (!configuredToken) {
      ctx.log.error("INTERNAL_OPS_TOKEN not configured");
      return NextResponse.json(
        { error: "Service not configured" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization");
    const providedToken = extractBearerToken(authHeader);
    if (!providedToken || !safeCompare(providedToken, configuredToken)) {
      ctx.log.warn("Invalid or missing INTERNAL_OPS_TOKEN");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const start = performance.now();
    try {
      const summary = await runIngestPostMetricsJob();
      const durationMs = Math.round(performance.now() - start);

      logEvent(ctx.log, EVENT_NAMES.GROWTH_METRICS_INGEST_COMPLETE, {
        reqId: ctx.reqId,
        routeId: ctx.routeId,
        status: 200,
        durationMs,
        outcome: "success",
        considered: summary.considered,
        appended: summary.appended,
        missing: summary.missing,
      });

      return NextResponse.json(summary, { status: 200 });
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      logEvent(ctx.log, EVENT_NAMES.GROWTH_METRICS_INGEST_COMPLETE, {
        reqId: ctx.reqId,
        routeId: ctx.routeId,
        status: 500,
        durationMs,
        outcome: "error",
        errorCode: "ingest_failed",
      });

      throw error;
    }
  }
);
