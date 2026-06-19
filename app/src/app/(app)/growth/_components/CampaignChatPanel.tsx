// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignChatPanel`
 * Purpose: An EPHEMERAL, thread-less "chat with the AI" window for the campaign
 *   detail page, plus the KEY feature — a LIVE TOOL-USAGE FEED. The human can
 *   watch the agent stream text AND render its tool calls live (research,
 *   drafting, etc.) instead of staring at a stalled "Generate" button.
 * Scope: Client component. REUSES the shared chat infra (ChatRuntimeProvider +
 *   kit Thread) with NO thread sidebar, NO thread list/persistence, NO useThreads
 *   — a single fresh session (empty initialMessages, null initialStateKey).
 * Invariants:
 *   - THREADLESS: never reads/writes the thread list; one ephemeral session.
 *   - REUSE_ONLY: imports shared chat infra as-is; does not modify it.
 *   - DEFAULT_GRAPH: targets the standard chat graph (DEFAULT_GRAPH_ID) so the
 *     panel works regardless of any in-flight growth-specific graph.
 *   - TOOL_FEED_INSIDE_RUNTIME: the live feed reads thread state via useToolFeed,
 *     so it must render inside ChatRuntimeProvider's runtime tree.
 * Side-effects: IO (chat API via the runtime; model list via React Query).
 * Links: src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx,
 *   ./tool-feed/ToolFeed.tsx, ../[campaignId]/view.tsx
 * @internal
 */

"use client";

import type { ModelRef } from "@cogni/ai-core";
import { signOut } from "next-auth/react";
import { type ReactElement, useMemo } from "react";

import { Thread } from "@/components";
import { ChatRuntimeProvider } from "@/features/ai/chat/providers/ChatRuntimeProvider.client";
import { DEFAULT_GRAPH_ID, useModels } from "@/features/ai/public";

import { ToolFeed } from "./tool-feed/ToolFeed";
import { useToolFeed } from "./tool-feed/useToolFeed";

/**
 * Lives INSIDE ChatRuntimeProvider so it can subscribe to the running thread.
 * Renders the chat thread on the left and the live tool-usage feed on the right.
 */
function ChatPanelBody(): ReactElement {
  const { items, isRunning } = useToolFeed();

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_minmax(13rem,18rem)]">
      <div className="min-h-0 overflow-hidden rounded-lg border bg-background">
        <Thread />
      </div>
      <aside className="min-h-0 overflow-y-auto rounded-lg border bg-muted/20 p-3">
        <ToolFeed items={items} isRunning={isRunning} />
      </aside>
    </div>
  );
}

export interface CampaignChatPanelProps {
  /** Campaign context — seeds the system intent so the agent stays on-task. */
  campaignId: string;
}

/**
 * Ephemeral campaign chat + live tool-usage feed.
 *
 * Gating is deliberately light versus the full /chat view: this is a watch
 * window, not the primary chat surface. It renders once a model ref resolves
 * from the server (NO client-invented model IDs); until then it shows a hint.
 */
export function CampaignChatPanel({
  campaignId,
}: CampaignChatPanelProps): ReactElement {
  const modelsQuery = useModels();

  // Resolve a model ref from the SERVER list only (INV-NO-CLIENT-INVENTED-MODEL-IDS):
  // prefer the server default, else the first free model.
  const modelRef: ModelRef | null = useMemo(() => {
    const data = modelsQuery.data;
    if (!data) return null;
    if (data.defaultRef) return data.defaultRef;
    const free = data.models.find((m) => !m.requiresPlatformCredits);
    return free?.ref ?? data.models[0]?.ref ?? null;
  }, [modelsQuery.data]);

  const defaultModelId =
    modelsQuery.data?.defaultRef?.modelId ??
    modelsQuery.data?.models[0]?.ref.modelId ??
    null;

  return (
    <section
      className="flex min-h-[28rem] flex-col gap-3"
      aria-label="Campaign AI chat"
      data-campaign-id={campaignId}
    >
      <div>
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Watch the AI work
        </h2>
        <p className="text-muted-foreground text-xs">
          Ask the agent to research or draft — its text and tool calls stream
          live below. This is an ephemeral session (nothing is saved to your
          chat history).
        </p>
      </div>

      {!modelRef || !defaultModelId ? (
        <div className="flex min-h-[20rem] flex-1 items-center justify-center rounded-lg border border-dashed bg-muted/10">
          <p className="text-muted-foreground text-sm">
            {modelsQuery.isError
              ? "Couldn't load the AI model list."
              : "Loading the AI…"}
          </p>
        </div>
      ) : (
        <ChatRuntimeProvider
          modelRef={modelRef}
          selectedGraph={DEFAULT_GRAPH_ID}
          defaultModelId={defaultModelId}
          initialMessages={[]}
          initialStateKey={null}
          onAuthExpired={() => signOut()}
        >
          <ChatPanelBody />
        </ChatRuntimeProvider>
      )}
    </section>
  );
}
