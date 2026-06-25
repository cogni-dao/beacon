// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/observability/logging/logger`
 * Purpose: Pino logger factory - JSON-only stdout emission.
 * Scope: Create configured pino loggers. Does not handle request-scoped logging.
 * Invariants: Always emits JSON to stdout; no worker transports; env label added by Alloy. Safe to call at module scope (no env validation).
 * Side-effects: none
 * Notes: Use makeLogger for app logger; use makeNoopLogger for tests. Formatting via external pipe (pino-pretty).
 * Notes: Reads logging-specific env vars directly (NODE_ENV, PINO_LOG_LEVEL, SERVICE_NAME) and resolves nodeId from repo-spec via COGNI_REPO_PATH — all without serverEnv() to avoid triggering full env validation at module load time.
 * Links: Initializes redaction paths via REDACT_PATHS; used by container and route handlers.
 * @public
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import pino from "pino";

import { REDACT_PATHS } from "./redact";

export type { Logger } from "pino";

// Resolved once, lazily, from repo-spec on disk. `undefined` = not yet attempted,
// `null` = attempted and unavailable (logger must never throw, so we degrade silently).
let cachedNodeId: string | null | undefined;

/**
 * Resolve the node identity for log base bindings.
 *
 * Node identity flows from `.cogni/repo-spec.yaml` (not env), located via the same
 * `COGNI_REPO_PATH` the rest of the app uses. Read here directly — NOT via
 * `getNodeId()`/`serverEnv()` — because module-scoped loggers are constructed at
 * import time and MUST NOT trigger full env validation (see file invariants).
 *
 * Without this, module-scoped loggers (`makeLogger({ component })`) emit lines with
 * no `nodeId`, so the operator's node-scoped Loki proxy filters them out entirely —
 * including the only adapter error logs that carry a failure's root cause.
 */
function resolveNodeId(): string | null {
  if (cachedNodeId !== undefined) return cachedNodeId;
  cachedNodeId = null;
  try {
    const repoRoot = process.env.COGNI_REPO_PATH ?? process.env.COGNI_REPO_ROOT;
    if (repoRoot) {
      const content = fs.readFileSync(
        path.join(repoRoot, ".cogni", "repo-spec.yaml"),
        "utf8"
      );
      const match = content.match(/^\s*node_id:\s*["']?([^"'\s]+)/m);
      if (match?.[1]) cachedNodeId = match[1];
    }
  } catch {
    // Logger must never throw — degrade to no nodeId binding.
  }
  return cachedNodeId;
}

export function makeLogger(bindings?: Record<string, unknown>): Logger {
  const isVitest = process.env.VITEST === "true";
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const pinoLogLevel = process.env.PINO_LOG_LEVEL ?? "info";
  const serviceName = process.env.SERVICE_NAME ?? "app";

  // Silence logs in test tooling (VITEST or NODE_ENV=test)
  const isTestTooling = isVitest || nodeEnv === "test";

  const config = {
    level: pinoLogLevel,
    enabled: !isTestTooling,
    // Stable base: resolved nodeId first (so explicit bindings can override),
    // then caller bindings, then reserved keys (prevents overwrite).
    // nodeId MUST be present on every line — the operator's node-scoped Loki proxy
    // filters out lines without it. env label added by Alloy from DEPLOY_ENVIRONMENT.
    base: {
      ...(resolveNodeId() ? { nodeId: resolveNodeId() } : {}),
      ...bindings,
      app: "cogni-template",
      service: serviceName,
    },
    messageKey: "msg",
    timestamp: pino.stdTimeFunctions.isoTime, // RFC3339 format (matches Alloy stage.timestamp)
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };

  // Always emit JSON to stdout (fd 1)
  // Sync mode + zero buffering until proven stable (prevents delayed/missing logs under SSE)
  // Formatting happens externally (pipe to pino-pretty if desired)
  return pino(
    config,
    pino.destination({
      dest: 1,
      sync: true,
      minLength: 0,
    })
  );
}

/**
 * For tests - pino with enabled:false (preserves type, silences output)
 */
export function makeNoopLogger(): Logger {
  return pino({ enabled: false });
}
