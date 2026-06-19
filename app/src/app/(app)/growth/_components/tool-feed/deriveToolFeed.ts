// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/tool-feed/deriveToolFeed`
 * Purpose: PURE derivation of a live "tool-usage feed" from assistant-ui thread
 *   messages. Walks every assistant message's content parts and flattens the
 *   `tool-call` parts (and the ephemeral `data` status parts) into a flat,
 *   chronological feed the human can watch while the agent works.
 * Scope: Pure function + types only. NO React, NO IO, NO runtime coupling — the
 *   only input is the stable assistant-ui `ThreadMessage[]` shape, so it is
 *   trivially testable by feeding mock messages built from streamed
 *   tool-input-start / tool-input-available / tool-output-available events.
 * Invariants:
 *   - PURE: deterministic; same messages in → same feed out.
 *   - TOOL_STATE_FROM_RESULT: a tool item is "running" until its part carries a
 *     `result` (or `isError`), then "done"/"error". This mirrors how the chat
 *     route closes a tool call with tool-output-available.
 * Side-effects: none
 * Links: ./ToolFeed.tsx, ./useToolFeed.ts, src/app/api/v1/ai/chat/route.ts
 * @internal
 */

import type { ThreadMessage } from "@assistant-ui/react";

/** A single rendered row in the live tool-usage feed. */
export interface ToolFeedItem {
  /** Stable key: tool item keyed by call id; status item keyed by index. */
  readonly id: string;
  readonly kind: "tool" | "status";
  /** Tool name (for kind="tool") or status phase (for kind="status"). */
  readonly label: string;
  /** One-line summary of the tool args, or the status label. */
  readonly detail?: string;
  /** Lifecycle of a tool call. Status rows are always "info". */
  readonly state: "running" | "done" | "error" | "info";
  /** Stringified tool result/output, present once the call completes. */
  readonly result?: string;
}

/** A tool-call content part as produced by assistant-ui from the stream. */
interface ToolCallPart {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args?: unknown;
  readonly argsText?: string;
  readonly result?: unknown;
  readonly isError?: boolean;
}

/** A transient data/status part (from the route's data-status chunk). */
interface DataPart {
  readonly type: "data";
  readonly name: string;
  readonly data: unknown;
}

function isToolCallPart(part: { type: string }): part is ToolCallPart {
  return part.type === "tool-call";
}

function isStatusDataPart(part: { type: string }): part is DataPart {
  // The chat route emits `data-status`; assistant-ui surfaces it as a `data`
  // part named "status". Accept either spelling defensively.
  if (part.type !== "data") return false;
  const name = (part as DataPart).name;
  return name === "status" || name === "data-status";
}

/** Truncate a long single-line string for the feed. */
function clip(value: string, max = 140): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Best-effort one-line summary of arbitrary tool args. */
function summarizeArgs(args: unknown, argsText?: string): string | undefined {
  if (args && typeof args === "object" && Object.keys(args).length > 0) {
    return clip(JSON.stringify(args));
  }
  if (argsText && argsText.trim().length > 0) return clip(argsText);
  return undefined;
}

/** Best-effort one-line summary of a tool result/output. */
function summarizeResult(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === "string") return clip(result);
  return clip(JSON.stringify(result));
}

/** Best-effort label from a status data payload `{ phase, label? }`. */
function statusRow(data: unknown, index: number): ToolFeedItem | null {
  if (!data || typeof data !== "object") return null;
  const phase =
    "phase" in data && typeof data.phase === "string"
      ? data.phase
      : undefined;
  const label =
    "label" in data && typeof data.label === "string"
      ? data.label
      : undefined;
  if (!phase && !label) return null;
  return {
    id: `status-${index}`,
    kind: "status",
    label: phase ?? "status",
    ...(label !== undefined ? { detail: label } : {}),
    state: "info",
  };
}

/**
 * Flatten assistant-ui thread messages into the live tool-usage feed.
 *
 * Only assistant messages carry tool calls; user messages are skipped. Tool
 * items reflect their lifecycle: a call with no `result` is "running"; once a
 * result arrives it becomes "done" (or "error" when `isError`).
 */
export function deriveToolFeed(
  messages: readonly ThreadMessage[]
): ToolFeedItem[] {
  const feed: ToolFeedItem[] = [];
  let statusSeq = 0;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (isToolCallPart(part)) {
        const hasResult = part.result !== undefined;
        const detail = summarizeArgs(part.args, part.argsText);
        const result = summarizeResult(part.result);
        feed.push({
          id: part.toolCallId,
          kind: "tool",
          label: part.toolName,
          ...(detail !== undefined ? { detail } : {}),
          state: part.isError ? "error" : hasResult ? "done" : "running",
          ...(result !== undefined ? { result } : {}),
        });
      } else if (isStatusDataPart(part)) {
        const row = statusRow(part.data, statusSeq++);
        if (row) feed.push(row);
      }
    }
  }

  return feed;
}
