// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/board/BoardColumn`
 * Purpose: One Kanban column of the campaign pipeline board — a droppable lane with a
 *   sticky head (label + role + count + a contextual action slot for that stage's
 *   AI-trigger) and a scrollable body of cards. This is where the "AI-triggers" the
 *   owner disliked now live: attached to the column they advance, not a floating panel.
 * Scope: Presentational + a dnd-kit drop target. Owns no card state; the parent board
 *   decides what a drop means (see CampaignBoard.onDragEnd). Renders `null` action slot
 *   when a stage has no trigger (Ready/Posted/Rejected).
 * Invariants:
 *   - DROP_IS_PARENT_DECIDED: the column only registers as a drop target; it never
 *     mutates — the board maps (from-stage → this stage) to a single safe action.
 * Side-effects: none
 * Links: ../CampaignBoard.tsx, ./boardMeta.ts
 * @internal
 */

"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@cogni/node-ui-kit/util/cn";
import type { PipelineStage } from "@/app/_facades/growth/campaigns.shared";

import { STAGE_META } from "./boardMeta";

export function BoardColumn({
  stage,
  count,
  droppable = true,
  headAction,
  children,
}: {
  stage: PipelineStage;
  count: number;
  /** Whether cards can be dropped here (Opportunities is pre-draft → not a target). */
  droppable?: boolean;
  /** The stage's contextual trigger (capture / research / generate), or nothing. */
  headAction?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const meta = STAGE_META[stage];
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${stage}`,
    data: { stage },
    disabled: !droppable,
  });

  return (
    <section
      ref={droppable ? setNodeRef : undefined}
      aria-label={`${meta.label} column`}
      className={cn(
        "flex h-full w-[19rem] shrink-0 flex-col rounded-xl border border-border bg-muted/30 transition-colors",
        droppable && isOver && "border-primary/60 bg-primary/5"
      )}
    >
      <header className="sticky top-0 z-10 flex flex-col gap-2 rounded-t-xl border-border/60 border-b bg-muted/60 px-3 py-2.5 backdrop-blur-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="flex items-baseline gap-1.5 font-semibold text-sm">
            {meta.label}
            <span className="font-normal text-muted-foreground text-xs">
              {meta.role}
            </span>
          </h2>
          <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
            {count}
          </span>
        </div>
        {headAction}
      </header>

      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {children}
      </div>
    </section>
  );
}
