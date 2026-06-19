// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/tool-feed/ToolFeed`
 * Purpose: PRESENTATIONAL live "tool-usage feed" — renders the derived
 *   ToolFeedItem[] as a running log (tool name, args summary, result/status) so
 *   a human watches the agent work instead of staring at a stall. Visual nod to
 *   the cogni-dao/red homepage "RUNNING" tool feed (look only).
 * Scope: Pure render from props. No data fetching, no runtime coupling — takes a
 *   feed array + a running flag, so it is fully testable with mock items.
 * Side-effects: none
 * Links: ./deriveToolFeed.ts, ./useToolFeed.ts
 * @internal
 */

"use client";

import { cn } from "@cogni/node-ui-kit/util/cn";
import { CheckCircle2, Circle, Loader2, Wrench, XCircle } from "lucide-react";
import type { ReactElement } from "react";

import type { ToolFeedItem } from "./deriveToolFeed";

function StateIcon({ state }: { state: ToolFeedItem["state"] }): ReactElement {
  if (state === "running") {
    return (
      <Loader2
        className="size-3.5 shrink-0 animate-spin text-amber-500"
        aria-hidden="true"
      />
    );
  }
  if (state === "done") {
    return (
      <CheckCircle2
        className="size-3.5 shrink-0 text-emerald-500"
        aria-hidden="true"
      />
    );
  }
  if (state === "error") {
    return (
      <XCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
    );
  }
  return (
    <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
  );
}

function FeedRow({ item }: { item: ToolFeedItem }): ReactElement {
  const isTool = item.kind === "tool";
  return (
    <li
      className={cn(
        "fade-in slide-in-from-bottom-1 flex animate-in flex-col gap-0.5 rounded-md border px-2.5 py-1.5 duration-150",
        item.state === "running" && "border-amber-500/40 bg-amber-500/5",
        item.state === "error" && "border-destructive/40 bg-destructive/5",
        item.state === "done" && "border-border bg-muted/30",
        item.state === "info" && "border-dashed border-border bg-transparent"
      )}
      data-testid={isTool ? "tool-feed-tool" : "tool-feed-status"}
      data-state={item.state}
    >
      <div className="flex items-center gap-1.5">
        <StateIcon state={item.state} />
        {isTool && (
          <Wrench
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="truncate font-medium font-mono text-xs">
          {item.label}
        </span>
      </div>
      {item.detail && (
        <p className="truncate pl-5 text-muted-foreground text-xs">
          {item.detail}
        </p>
      )}
      {item.result && (
        <p className="line-clamp-2 pl-5 text-muted-foreground/80 text-xs">
          → {item.result}
        </p>
      )}
    </li>
  );
}

export interface ToolFeedProps {
  items: readonly ToolFeedItem[];
  /** When true (and feed empty), show a "waiting for the agent" hint. */
  isRunning?: boolean;
}

/**
 * Live tool-usage feed. Renders nothing-but-a-hint when empty so the panel
 * doesn't show a dead box before the first stream event.
 */
export function ToolFeed({ items, isRunning }: ToolFeedProps): ReactElement {
  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="tool-feed">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-block size-2 rounded-full",
            isRunning
              ? "animate-pulse bg-amber-500"
              : items.length > 0
                ? "bg-emerald-500"
                : "bg-muted-foreground/40"
          )}
          aria-hidden="true"
        />
        <h3 className="font-medium font-mono text-muted-foreground text-xs uppercase tracking-wide">
          {isRunning ? "Running" : "Tool activity"}
        </h3>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs" data-testid="tool-feed-empty">
          {isRunning
            ? "Waiting for the agent to pick up a tool…"
            : "No tool activity yet. Ask the agent to research or draft."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 overflow-y-auto">
          {items.map((item) => (
            <FeedRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
