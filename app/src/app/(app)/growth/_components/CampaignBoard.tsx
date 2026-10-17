// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignBoard`
 * Purpose: The campaign detail page's primary surface — a Kanban board whose columns
 *   ARE the growth loop (Opportunities → Drafts → Ready → Posted, + a Rejected drawer),
 *   per the hub's `strat-measure-learn`. Replaces the old funnel-grouped list + status
 *   filter + detached control panel: each stage's AI-trigger (capture/research/generate)
 *   now lives on the column it advances, per-layer KPI moves to a header strip, and
 *   drafts are compressed decision cards that expand to the proven `DraftCard`.
 * Scope: Client component — splits the facade's posts into columns by `postStage`,
 *   owns the dnd-kit drag context, and maps a drop to ONE safe transition. All heavy
 *   review/publish logic stays in `DraftCard`; all mutations go through the existing
 *   mutate wrappers + `router.refresh()`.
 * Invariants:
 *   - DRAG_IS_SAFE_ONLY: a drop performs only reversible, non-publishing transitions —
 *     drag-right to Ready = approve (when the Moltbook payload is ready), drag to
 *     Rejected = reject. Publishing stays an explicit, confirmed action on the card
 *     (never a bare drop) — the hub forbids incidental posting.
 *   - STAGE_FROM_STATUS: a card's column is derived from `posts.status` via `postStage`;
 *     this component never invents a status the API doesn't persist.
 * Side-effects: IO via mutate wrappers (approve/reject/research/generate) + refresh.
 * Links: ./board/*, ./DraftCard.tsx, ./CampaignResearchEvidence.tsx,
 *   ../_api/mutateCampaign.ts, @/app/_facades/growth/campaigns.shared
 * @internal
 */

"use client";

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  deriveMoltbookPayloadFromDraft,
  type MoltbookPostPayload,
} from "@cogni/ai-tools";
import { Sparkles, Telescope } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useMemo, useState } from "react";

import { Button } from "@/components";
import type {
  CampaignDetail,
  CampaignPost,
} from "@/app/_facades/growth/campaigns.server";
import {
  type DraftStage,
  postStage,
} from "@/app/_facades/growth/campaigns.shared";

import {
  approvePost,
  generatePosts,
  rejectPost,
  runResearch,
} from "../_api/mutateCampaign";
import { CampaignResearchEvidence } from "./CampaignResearchEvidence";
import { BoardCard } from "./board/BoardCard";
import { BoardColumn } from "./board/BoardColumn";
import { IdeaCapture } from "./board/IdeaCapture";
import { KpiStrip } from "./board/KpiStrip";

/** Whether a draft's Moltbook payload is complete enough to approve on drop. */
function moltbookReady(post: CampaignPost): boolean {
  const payload: MoltbookPostPayload =
    post.moltbook ??
    deriveMoltbookPayloadFromDraft({
      text: post.text,
      ...(post.angle ? { angle: post.angle } : {}),
      ...(post.topic ? { topic: post.topic } : {}),
    });
  return (
    payload.submoltName.trim().length > 0 &&
    payload.title.trim().length > 0 &&
    payload.content.trim().length > 0
  );
}

function approvePayload(post: CampaignPost): MoltbookPostPayload {
  const payload =
    post.moltbook ??
    deriveMoltbookPayloadFromDraft({
      text: post.text,
      ...(post.angle ? { angle: post.angle } : {}),
      ...(post.topic ? { topic: post.topic } : {}),
    });
  return {
    submoltName: payload.submoltName.trim(),
    title: payload.title.trim(),
    content: payload.content.trim(),
    type: payload.type,
  };
}

/** The four draft columns rendered left→right (Opportunities is handled separately). */
const DRAFT_COLUMNS: readonly DraftStage[] = [
  "drafts",
  "ready",
  "posted",
  "rejected",
];

export function CampaignBoard({
  campaign,
}: {
  campaign: CampaignDetail;
}): ReactElement {
  const router = useRouter();
  const [busyHead, setBusyHead] = useState<"research" | "generate" | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // A small drag distance keeps clicks (expand, buttons) from starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const byStage = useMemo(() => {
    const groups: Record<DraftStage, CampaignPost[]> = {
      drafts: [],
      ready: [],
      posted: [],
      rejected: [],
    };
    for (const post of campaign.posts) {
      groups[postStage(post.status)].push(post);
    }
    return groups;
  }, [campaign.posts]);

  const opportunityCount =
    campaign.findings.length + campaign.nextPostPriorities.length;

  const onDragEnd = async (event: DragEndEvent) => {
    setHint(null);
    const { active, over } = event;
    if (!over) return;
    const toStage = (over.data.current as { stage?: DraftStage } | undefined)
      ?.stage;
    const fromStage = (
      active.data.current as { fromStage?: DraftStage } | undefined
    )?.fromStage;
    if (!toStage || !fromStage || toStage === fromStage) return;

    const post = campaign.posts.find((p) => p.id === active.id);
    if (!post) return;

    try {
      if (toStage === "rejected") {
        // Reject is always safe and reversible-by-regenerating — the core triage move.
        await rejectPost(campaign.campaignId, post.id);
        router.refresh();
        return;
      }
      if (fromStage === "drafts" && toStage === "ready") {
        if (!moltbookReady(post)) {
          setHint("Open the draft to finish its Moltbook post before approving.");
          return;
        }
        await approvePost(campaign.campaignId, post.id, approvePayload(post));
        router.refresh();
        return;
      }
      // Publishing (→ Posted) and un-approving stay deliberate, on-card actions.
      setHint(
        toStage === "posted"
          ? "Publishing is a confirmed action — open the card to post."
          : "Open the card to change this draft."
      );
    } catch (err: unknown) {
      setHint(err instanceof Error ? err.message : String(err));
    }
  };

  const runHead = async (
    action: "research" | "generate",
    fn: () => Promise<number>
  ) => {
    setBusyHead(action);
    setHint(null);
    try {
      await fn();
      router.refresh();
    } catch (err: unknown) {
      setHint(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyHead(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip campaign={campaign} />

      {hint && (
        <p
          className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs"
          role="status"
        >
          {hint}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={onDragEnd}
      >
        {/* Horizontal board: columns scroll sideways on narrow screens. */}
        <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
          {/* Opportunities — capture + research evidence (pre-draft, not a drop target). */}
          <BoardColumn
            stage="opportunities"
            count={opportunityCount}
            droppable={false}
            headAction={
              <div className="flex flex-col gap-2">
                <IdeaCapture campaignId={campaign.campaignId} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 self-start px-2.5 text-xs"
                  disabled={busyHead !== null}
                  onClick={() =>
                    runHead("research", () => runResearch(campaign.campaignId))
                  }
                >
                  <Telescope className="size-3.5" aria-hidden="true" />
                  {busyHead === "research" ? "Researching…" : "Research"}
                </Button>
              </div>
            }
          >
            {opportunityCount === 0 ? (
              <p className="rounded-lg border border-border border-dashed p-4 text-center text-muted-foreground text-xs">
                No research yet. Capture an idea or run Research to surface
                opportunities.
              </p>
            ) : (
              <CampaignResearchEvidence
                findings={campaign.findings}
                currentThinking={campaign.currentThinking}
                nextPostPriorities={campaign.nextPostPriorities}
              />
            )}
          </BoardColumn>

          {DRAFT_COLUMNS.map((stage) => (
            <BoardColumn
              key={stage}
              stage={stage}
              count={byStage[stage].length}
              headAction={
                stage === "drafts" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 self-start px-2 text-muted-foreground text-xs"
                    disabled={busyHead !== null}
                    onClick={() =>
                      runHead("generate", () =>
                        generatePosts(campaign.campaignId)
                      )
                    }
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    {busyHead === "generate" ? "Generating…" : "Generate more"}
                  </Button>
                ) : undefined
              }
            >
              {byStage[stage].length === 0 ? (
                <p className="rounded-lg border border-border border-dashed p-4 text-center text-muted-foreground text-xs">
                  Nothing here yet.
                </p>
              ) : (
                byStage[stage].map((post) => (
                  <BoardCard
                    key={post.id}
                    campaignId={campaign.campaignId}
                    post={post}
                    moltbookConnection={campaign.moltbookConnection}
                  />
                ))
              )}
            </BoardColumn>
          ))}
        </div>
      </DndContext>
    </div>
  );
}
