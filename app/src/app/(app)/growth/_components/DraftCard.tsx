// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/DraftCard`
 * Purpose: The REVIEW + REFINE surface for ONE generated draft, rendered inside a
 *   funnel lane. Shows a clear state badge (generated/approved/rejected/refining/…),
 *   the AI `score` + `revision`, the post text, and the four per-draft human actions:
 *   Approve, Reject, Edit (inline edit + save), Refine (regenerate THIS draft —
 *   optionally with a feedback note — into a NEW revision via the gated facade).
 *   This is the owner's #1 surface: blast through drafts — approve the good, reject
 *   the slop, edit inline, refine the promising ones.
 * Scope: Client component — local edit/refine UI state + the review-action mutations.
 *   Refreshes via `router.refresh()` so the persisted change re-renders. No business
 *   logic (state transitions + the gated LLM call live in the API route).
 * Invariants:
 *   - OPTIMISTIC_VIA_REFRESH: actions persist server-side then `router.refresh()`;
 *     the badge/text/revision reflect the DB, never a client-only guess.
 *   - REFINE_IS_GATED: Refine calls the review-action route, whose LLM call runs
 *     through the `chatCompletion` facade (BILLABLE_AI_THROUGH_EXECUTOR) — this
 *     component never touches an LLM directly.
 * Side-effects: IO (PATCH .../posts/:postId via the mutate wrappers; router refresh).
 * Links: ./FunnelLayerSection.tsx, ../_api/mutateCampaign.ts,
 *   app/src/app/api/v1/growth/campaigns/[campaignId]/posts/[postId]/route.ts
 * @internal
 */

"use client";

import { Check, Pencil, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useState } from "react";

import { Badge, Button, Card, CardContent } from "@/components";
import type { CampaignPost } from "@/app/_facades/growth/campaigns.server";

import {
  approvePost,
  editPost,
  refinePost,
  rejectPost,
} from "../_api/mutateCampaign";

/** Map a post review status to a glanceable badge intent + label. */
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

type Busy = "approve" | "reject" | "edit" | "refine" | null;

export function DraftCard({
  campaignId,
  post,
}: {
  campaignId: string;
  post: CampaignPost;
}): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  // Inline-edit state.
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(post.text);

  // Refine-feedback state.
  const [refineOpen, setRefineOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const badge = statusBadge(post.status);
  const disabled = busy !== null;

  const run = async (action: Exclude<Busy, null>, fn: () => Promise<unknown>) => {
    setBusy(action);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        {/* Header: channel · topic + state badge / revision / score */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
          <span className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase">
              {post.channel}
            </span>
            {post.topic && (
              <span className="rounded bg-muted px-1.5 py-0.5">{post.topic}</span>
            )}
          </span>
          <span className="flex items-center gap-2 tabular-nums">
            {post.revision > 0 && <span>rev {post.revision}</span>}
            {post.score !== null && (
              <span title="AI quality score">
                score {(post.score * 100).toFixed(0)}
              </span>
            )}
            <Badge intent={badge.intent} size="sm">
              {badge.label}
            </Badge>
          </span>
        </div>

        {/* Body: read-only text OR inline editor */}
        {editing ? (
          <textarea
            aria-label="Edit draft text"
            className="min-h-32 w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            disabled={disabled}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {post.text}
          </p>
        )}

        {/* Refine feedback note (optional) */}
        {refineOpen && (
          <textarea
            aria-label="Refine feedback note (optional)"
            placeholder="Optional: how should this revision be better? (e.g. sharper hook, drop the jargon)"
            className="min-h-20 w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            disabled={disabled}
          />
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-border/60 border-t pt-2">
          {editing ? (
            <>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                disabled={disabled || draftText.trim().length === 0}
                onClick={() =>
                  run("edit", async () => {
                    await editPost(campaignId, post.id, draftText.trim());
                    setEditing(false);
                  })
                }
              >
                <Check className="size-3.5" aria-hidden="true" />
                {busy === "edit" ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                disabled={disabled}
                onClick={() => {
                  setEditing(false);
                  setDraftText(post.text);
                }}
              >
                Cancel
              </Button>
            </>
          ) : refineOpen ? (
            <>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                disabled={disabled}
                onClick={() =>
                  run("refine", async () => {
                    await refinePost(campaignId, post.id, feedback);
                    setRefineOpen(false);
                    setFeedback("");
                  })
                }
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                {busy === "refine" ? "Refining…" : "Refine draft"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                disabled={disabled}
                onClick={() => {
                  setRefineOpen(false);
                  setFeedback("");
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                disabled={disabled || post.status === "approved"}
                onClick={() =>
                  run("approve", () => approvePost(campaignId, post.id))
                }
              >
                <Check className="size-3.5" aria-hidden="true" />
                {busy === "approve" ? "Approving…" : "Approve"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={disabled || post.status === "rejected"}
                onClick={() =>
                  run("reject", () => rejectPost(campaignId, post.id))
                }
              >
                <X className="size-3.5" aria-hidden="true" />
                {busy === "reject" ? "Rejecting…" : "Reject"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={disabled}
                onClick={() => {
                  setDraftText(post.text);
                  setEditing(true);
                }}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={disabled}
                onClick={() => setRefineOpen(true)}
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                Refine
              </Button>
            </>
          )}
        </div>

        {error && (
          <p
            className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs"
            role="alert"
          >
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
