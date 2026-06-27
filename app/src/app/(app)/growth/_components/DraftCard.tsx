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

import {
  Check,
  ExternalLink,
  Pencil,
  Rocket,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useEffect, useState } from "react";
import {
  deriveMoltbookPayloadFromDraft,
  MOLTBOOK_SUBMOLT_OPTIONS,
  type MoltbookPostPayload,
} from "@cogni/ai-tools";

import { Badge, Button, Card, CardContent } from "@/components";
import type { CampaignPost } from "@/app/_facades/growth/campaigns.server";

import {
  approvePost,
  editPost,
  publishApprovedPost,
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

type Busy = "approve" | "reject" | "edit" | "refine" | "publish" | null;

function initialMoltbookPayload(post: CampaignPost): MoltbookPostPayload {
  const payload =
    post.moltbook ??
    deriveMoltbookPayloadFromDraft({
      text: post.text,
      ...(post.angle ? { angle: post.angle } : {}),
      ...(post.topic ? { topic: post.topic } : {}),
    });
  if (hasDuplicateMoltbookText(payload)) {
    return deriveMoltbookPayloadFromDraft({
      text: payload.content,
      submoltName: payload.submoltName,
      ...(post.angle ? { angle: post.angle } : {}),
      ...(post.topic ? { topic: post.topic } : {}),
    });
  }

  return payload;
}

function isMoltbookPayloadReady(payload: MoltbookPostPayload): boolean {
  return (
    payload.submoltName.trim().length > 0 &&
    payload.title.trim().length > 0 &&
    payload.content.trim().length > 0
  );
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function hasDuplicateMoltbookText(payload: MoltbookPostPayload): boolean {
  return normalized(payload.title) === normalized(payload.content);
}

function inferredPostUrl(post: CampaignPost): string | null {
  if (post.externalPostUrl) {
    return normalizeMoltbookPostUrl(post.externalPostUrl);
  }
  if (!post.externalPostId) {
    return null;
  }
  if (post.channel === "moltbook") {
    return `https://www.moltbook.com/post/${encodeURIComponent(post.externalPostId)}`;
  }
  if (post.channel === "x") {
    return `https://x.com/i/web/status/${encodeURIComponent(post.externalPostId)}`;
  }
  return null;
}

function normalizeMoltbookPostUrl(url: string): string {
  return url.replace(
    /^https:\/\/www\.moltbook\.com\/posts\//,
    "https://www.moltbook.com/post/"
  );
}

function relativePostedAt(postedAt: string | null): string | null {
  if (!postedAt) return null;
  const time = new Date(postedAt).getTime();
  if (!Number.isFinite(time)) return null;

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function submoltOptions(currentValue: string): string[] {
  const current = currentValue.trim();
  return Array.from(
    new Set([...MOLTBOOK_SUBMOLT_OPTIONS, ...(current ? [current] : [])])
  );
}

function MoltbookPreview({
  payload,
}: {
  payload: MoltbookPostPayload;
}): ReactElement {
  return (
    <section className="grid gap-2">
      <p className="font-semibold text-sm leading-relaxed">{payload.title}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {payload.content}
      </p>
    </section>
  );
}

function MoltbookEditor({
  payload,
  disabled,
  onChange,
}: {
  payload: MoltbookPostPayload;
  disabled: boolean;
  onChange: (payload: MoltbookPostPayload) => void;
}): ReactElement {
  return (
    <section className="grid gap-3 border-border/60 border-y py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-xs uppercase tracking-wide">
          Moltbook post
        </h3>
        <span className="text-muted-foreground text-xs">
          This is what will publish.
        </span>
      </div>
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Destination</span>
        <select
          aria-label="Moltbook destination"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={payload.submoltName}
          onChange={(event) =>
            onChange({
              ...payload,
              submoltName: event.target.value,
            })
          }
          disabled={disabled}
        >
          {submoltOptions(payload.submoltName).map((submoltName) => (
            <option key={submoltName} value={submoltName}>
              m/{submoltName}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Headline</span>
        <input
          aria-label="Moltbook headline"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={payload.title}
          onChange={(event) =>
            onChange({ ...payload, title: event.target.value })
          }
          disabled={disabled}
        />
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Post</span>
        <textarea
          aria-label="Moltbook post body"
          className="min-h-28 w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed"
          value={payload.content}
          onChange={(event) =>
            onChange({ ...payload, content: event.target.value })
          }
          disabled={disabled}
        />
      </label>
    </section>
  );
}

export function DraftCard({
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
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Inline-edit state.
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(post.text);
  const [payload, setPayload] = useState<MoltbookPostPayload>(() =>
    initialMoltbookPayload(post)
  );

  // Refine-feedback state.
  const [refineOpen, setRefineOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);

  const badge = statusBadge(post.status);
  const disabled = busy !== null;
  const payloadReady = isMoltbookPayloadReady(payload);
  const isMoltbook = post.channel === "moltbook";
  const isPosted = post.status === "posted";
  const postUrl = isPosted ? inferredPostUrl(post) : null;
  const postedRelative = isPosted ? relativePostedAt(post.postedAt) : null;
  const accountLabel =
    moltbookConnection?.handle ??
    moltbookConnection?.displayLabel ??
    "No Moltbook account connected";

  useEffect(() => {
    setDraftText(post.text);
    setPayload(initialMoltbookPayload(post));
    setPublishOpen(false);
    if (post.status === "posted") {
      setEditing(false);
      setRefineOpen(false);
      setFeedback("");
    }
  }, [post.id, post.text, post.revision, post.status]);

  const run = async <T,>(
    action: Exclude<Busy, null>,
    fn: () => Promise<T>,
    onSuccess?: (result: T) => void
  ) => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      onSuccess?.(result);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card id={`post-${post.id}`} className="scroll-mt-4">
      <CardContent className="flex flex-col gap-3 pt-4">
        {/* Header: channel · topic + state badge / revision / score */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
          <span className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase">
              {post.channel}
            </span>
            {isMoltbook && (
              <span className="rounded bg-muted px-1.5 py-0.5">
                m/{payload.submoltName}
              </span>
            )}
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
            {postedRelative && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                {postedRelative}
              </span>
            )}
            {postUrl && (
              <a
                className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                href={postUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                View post
              </a>
            )}
            {!isPosted && notice && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                {notice}
              </span>
            )}
          </span>
        </div>

        {/* Body: read-only preview OR inline editor */}
        {editing && isMoltbook ? (
          <MoltbookEditor
            payload={payload}
            disabled={disabled}
            onChange={setPayload}
          />
        ) : editing ? (
          <textarea
            aria-label="Edit draft text"
            className="min-h-32 w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            disabled={disabled}
          />
        ) : isMoltbook ? (
          <MoltbookPreview payload={payload} />
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
        {!isPosted && (
          <div className="flex flex-wrap items-center gap-2 border-border/60 border-t pt-2">
            {editing ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={
                    disabled ||
                    (isMoltbook ? !payloadReady : draftText.trim().length === 0)
                  }
                  onClick={() =>
                    run("edit", async () => {
                      const nextText = isMoltbook
                        ? payload.content.trim()
                        : draftText.trim();
                      const result = await editPost(campaignId, post.id, {
                        text: nextText,
                        moltbook: {
                          submoltName: payload.submoltName.trim(),
                          title: payload.title.trim(),
                          content: payload.content.trim(),
                          type: "text",
                        },
                      });
                      setEditing(false);
                      setNotice("Saved just now");
                      return result;
                    })
                  }
                >
                  <Save className="size-3.5" aria-hidden="true" />
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
                    setPayload(initialMoltbookPayload(post));
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
                  disabled={disabled || post.status === "approved" || !payloadReady}
                  onClick={() =>
                    run(
                      "approve",
                      () =>
                        approvePost(campaignId, post.id, {
                          submoltName: payload.submoltName.trim(),
                          title: payload.title.trim(),
                          content: payload.content.trim(),
                          type: "text",
                        }),
                      (result) => {
                        setNotice("Approved just now");
                        onStatusChange?.(result.status);
                      }
                    )
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
                    run(
                      "reject",
                      () => rejectPost(campaignId, post.id),
                      (result) => {
                        setNotice("Rejected just now");
                        onStatusChange?.(result.status);
                      }
                    )
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
                    setPayload(initialMoltbookPayload(post));
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
                {post.status === "approved" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    disabled={disabled || !moltbookConnection || !payloadReady}
                    onClick={() => setPublishOpen((open) => !open)}
                  >
                    <Rocket className="size-3.5" aria-hidden="true" />
                    Publish
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {!isPosted && publishOpen && (
          <div className="rounded-md border border-border bg-background p-3 text-sm">
            <div className="mb-2 grid gap-1">
              <p className="font-medium">Publish to Moltbook?</p>
              <p className="text-muted-foreground text-xs">
                Account: {accountLabel} · destination: m/{payload.submoltName}
              </p>
            </div>
            <div className="mb-3">
              <MoltbookPreview payload={payload} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                disabled={disabled || !moltbookConnection || !payloadReady}
                onClick={() =>
                  run(
                    "publish",
                    () => publishApprovedPost(campaignId, post.id),
                    (summary) => {
                      if (summary.published === 1) {
                        setNotice("Posted just now");
                        onStatusChange?.("posted");
                      } else if (summary.skippedMissingPayload > 0) {
                        setError("Save the Moltbook post before publishing.");
                      } else if (summary.skippedNoConnection > 0) {
                        setError("Connect a Moltbook account before publishing.");
                      } else {
                        setError("Publish did not complete; refresh and check status.");
                      }
                    }
                  )
                }
              >
                <Rocket className="size-3.5" aria-hidden="true" />
                {busy === "publish" ? "Publishing…" : "Publish now"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                disabled={disabled}
                onClick={() => setPublishOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

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
