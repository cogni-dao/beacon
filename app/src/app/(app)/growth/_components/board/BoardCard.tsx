// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/board/BoardCard`
 * Purpose: A draft on the pipeline board, rendered as a COMPRESSED decision (per the
 *   hub's `synthesize-not-reports`): channel + funnel tag + state badge + score, a
 *   two-line preview, and the one or two most-common triage actions. The full editor
 *   (approve / edit / refine / publish, with the Moltbook payload) is one tap away —
 *   expanding the card renders the proven `DraftCard` inline, so no review/publish
 *   logic is re-implemented here.
 * Scope: Client component — a dnd-kit draggable (drag by the grip handle) plus its own
 *   quick-action busy state; delegates everything heavy to `DraftCard`.
 * Invariants:
 *   - DECISION_FIRST: collapsed view shows a takeaway + next action, not the wall of
 *     text; the body is a drill-down (expand), never the primary surface.
 *   - REUSE_DRAFTCARD: approve/edit/refine/publish live in `DraftCard` only; this card
 *     re-implements at most the safe, one-call quick actions (reject, refine).
 *   - DRAG_BY_HANDLE: only the grip starts a drag, so buttons/expand stay clickable.
 * Side-effects: IO via the quick-action mutate wrappers + `router.refresh()`.
 * Links: ./CampaignBoard.tsx, ../DraftCard.tsx, ../../_api/mutateCampaign.ts
 * @internal
 */

"use client";

import { useDraggable } from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GripVertical,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useState } from "react";

import { cn } from "@cogni/node-ui-kit/util/cn";
import { Badge, Button } from "@/components";
import type { CampaignPost } from "@/app/_facades/growth/campaigns.server";
import { postStage } from "@/app/_facades/growth/campaigns.shared";

import { refinePost, rejectPost } from "../../_api/mutateCampaign";
import { DraftCard } from "../DraftCard";

/** Compact state badge (mirrors DraftCard's mapping; kept local to avoid coupling). */
function statusBadge(status: string): {
  intent: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
  switch (status) {
    case "approved":
      return { intent: "default", label: "Approved" };
    case "rejected":
      return { intent: "destructive", label: "Rejected" };
    case "refining":
      return { intent: "secondary", label: "Refining…" };
    case "posted":
      return { intent: "default", label: "Posted" };
    case "failed":
      return { intent: "destructive", label: "Failed" };
    case "in_review":
      return { intent: "outline", label: "In review" };
    default:
      return { intent: "outline", label: "Generated" };
  }
}

/** The one-line engagement summary for a posted card (the MEASURE glance). */
function PostedMetrics({ post }: { post: CampaignPost }): ReactElement | null {
  if (post.status !== "posted") return null;
  const url = post.externalPostUrl;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs tabular-nums">
      {post.impressions !== null && <span>{post.impressions} views</span>}
      <span>{post.likes} likes</span>
      <span>{post.reposts} reposts</span>
      <span>{post.replies} replies</span>
      {url && (
        <a
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          View
        </a>
      )}
    </div>
  );
}

export function BoardCard({
  campaignId,
  post,
  moltbookConnection,
  onStatusChange,
}: {
  campaignId: string;
  post: CampaignPost;
  moltbookConnection: {
    handle: string | null;
    displayLabel: string | null;
  } | null;
  onStatusChange?: (status: string) => void;
}): ReactElement {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"reject" | "refine" | null>(null);

  const stage = postStage(post.status);
  const draggable = stage === "drafts" || stage === "ready";

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: post.id,
      data: { fromStage: stage },
      disabled: !draggable,
    });

  const badge = statusBadge(post.status);
  const preview =
    post.moltbook?.title?.trim() || post.text.trim() || "(empty draft)";

  const runQuick = async (
    action: "reject" | "refine",
    fn: () => Promise<unknown>
  ) => {
    setBusy(action);
    try {
      await fn();
      if (action === "reject") onStatusChange?.("rejected");
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={cn(
        "rounded-lg border border-border bg-background shadow-sm",
        isDragging && "opacity-50"
      )}
    >
      {/* Compressed header: grip · channel · funnel tag · state · score */}
      <div className="flex items-start gap-1.5 px-2.5 pt-2.5">
        {draggable && (
          <button
            type="button"
            aria-label="Drag to move"
            className="mt-0.5 cursor-grab touch-none text-muted-foreground/60 hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
            <span className="font-medium text-foreground uppercase">
              {post.channel}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 uppercase">
              {post.funnelLayer}
            </span>
            {post.topic && (
              <span className="truncate rounded bg-muted px-1.5 py-0.5">
                {post.topic}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1.5 tabular-nums">
              {post.revision > 0 && <span>rev {post.revision}</span>}
              {post.score !== null && (
                <span title="AI quality score">
                  {(post.score * 100).toFixed(0)}
                </span>
              )}
              <Badge intent={badge.intent} size="sm">
                {badge.label}
              </Badge>
            </span>
          </div>

          {/* Two-line takeaway (the decision), not the full body. */}
          {!expanded && (
            <p className="line-clamp-2 text-sm leading-snug">{preview}</p>
          )}

          {post.status === "posted" && !expanded && (
            <PostedMetrics post={post} />
          )}
        </div>
      </div>

      {/* Expanded: the full, proven review/refine/publish surface. */}
      {expanded && (
        <div className="px-2.5 pb-1">
          <DraftCard
            campaignId={campaignId}
            post={post}
            moltbookConnection={moltbookConnection}
            {...(onStatusChange ? { onStatusChange } : {})}
          />
        </div>
      )}

      {/* Quick actions: reject/refine the slop fast; open the promising ones. */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        {stage === "drafts" && !expanded && (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              disabled={busy !== null}
              onClick={() => runQuick("reject", () => rejectPost(campaignId, post.id))}
            >
              <X className="size-3.5" aria-hidden="true" />
              {busy === "reject" ? "…" : "Reject"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              disabled={busy !== null}
              onClick={() =>
                runQuick("refine", () => refinePost(campaignId, post.id))
              }
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              {busy === "refine" ? "…" : "Refine"}
            </Button>
          </>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1 px-2 text-muted-foreground text-xs"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3.5" aria-hidden="true" />
              Close
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" aria-hidden="true" />
              {stage === "ready" ? "Review & publish" : "Open"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
