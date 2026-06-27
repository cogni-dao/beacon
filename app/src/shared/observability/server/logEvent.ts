// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/observability/server/logEvent`
 * Purpose: Beacon-typed wrapper around the shared logEvent helper.
 * Scope: Lets app-local event names use the same reqId enforcement as shared events.
 * Invariants: `fields.reqId` is still enforced by `@cogni/node-shared`.
 * Side-effects: IO (logging)
 * @public
 */

import {
  logEvent as logSharedEvent,
  type EventBase,
  type EventName as SharedEventName,
} from "@cogni/node-shared";
import type { Logger } from "pino";

import type { EventName } from "../events";

export function logEvent(
  logger: Logger,
  eventName: EventName,
  fields: EventBase & Record<string, unknown>,
  message?: string
): void {
  logSharedEvent(logger, eventName as SharedEventName, fields, message);
}
