// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignChatPanel`
 * Purpose: An EPHEMERAL, thread-less "chat with the AI" window for the campaign
 *   detail page. The human watches the marketing strategist stream text AND its
 *   tool calls (knowledge_search/knowledge_read) live — instead of staring at a
 *   stalled "Generate" button.
 * Scope: Client component. REUSES the shared chat infra AS-IS — ChatRuntimeProvider
 *   + the kit Thread. The kit Thread already renders tool calls inline via the
 *   vendor assistant-ui `ToolFallback` (thread.tsx), so there is NO bespoke
 *   tool-feed widget: tool usage streams in the thread itself. NO thread sidebar,
 *   NO thread list/persistence, NO useThreads — a single fresh session.
 * Invariants:
 *   - THREADLESS: never reads/writes the thread list; one ephemeral session.
 *   - REUSE_ONLY: imports shared chat infra as-is; does not modify it and adds no
 *     parallel tool-rendering — the Thread's native ToolFallback is the feed.
 *   - GROWTH_CHAT_GRAPH: targets the dedicated marketing-strategist catalog graph
 *     `langgraph:growth-chat` (NOT generic brain), which recalls the seeded
 *     campaign playbook live, so the streamed tool calls are real knowledge lookups.
 *   - CAMPAIGN_AWARE: the campaign title + brief seed the opening user turn so the
 *     strategist grounds its first recall on THIS campaign.
 * Side-effects: IO (chat API via the runtime; model list via React Query).
 * Links: src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx,
 *   src/components/vendor/assistant-ui/thread.tsx (ToolFallback), ../[campaignId]/view.tsx
 * @internal
 */

"use client";

import type { GraphId, ModelRef } from "@cogni/ai-core";
import type { UIMessage } from "ai";
import { signOut } from "next-auth/react";
import { type ReactElement, useMemo } from "react";

import { Thread } from "@/components";
import { ChatRuntimeProvider } from "@/features/ai/chat/providers/ChatRuntimeProvider.client";
import { useModels } from "@/features/ai/public";

/**
 * The dedicated marketing-strategist catalog graph the panel watches. Recalls the
 * seeded campaign playbook (beacon-brand-voice / beacon-campaigns /
 * beacon-post-performance) live, so the streamed tool calls are real knowledge lookups.
 */
const GROWTH_CHAT_GRAPH_ID: GraphId = "langgraph:growth-chat";

/**
 * Seed the opening user turn with the campaign so the strategist's first recall is
 * grounded on THIS campaign. Sent as a normal user message (the runtime forwards
 * the latest user text to the route); the system prompt drives the recall recipe.
 */
function campaignOpeningMessages(title: string, brief: string): UIMessage[] {
  const text = [
    `Campaign: ${title}`,
    "",
    "Brief:",
    brief.trim() || "(no brief provided)",
    "",
    "Recall this brand's playbook for the topics above, then assess this campaign across funnel, voice, hooks, cadence, and metric — recommend what to do next.",
  ].join("\n");
  return [
    {
      id: "campaign-context",
      role: "user",
      parts: [{ type: "text", text }],
    },
  ];
}

export interface CampaignChatPanelProps {
  /** Campaign id — surfaced for tooling/analytics, not sent to the model. */
  campaignId: string;
  /** Campaign title — seeds the strategist's opening turn so recall is on-topic. */
  title: string;
  /** Campaign brief — seeds the strategist's opening turn so recall is on-topic. */
  brief: string;
}

/**
 * Ephemeral campaign chat. Reuses the shared Thread, whose native ToolFallback
 * renders the agent's tool calls inline as they stream.
 *
 * Gating is deliberately light versus the full /chat view: this is a watch
 * window, not the primary chat surface. It renders once a model ref resolves
 * from the server (NO client-invented model IDs); until then it shows a hint.
 */
export function CampaignChatPanel({
  campaignId,
  title,
  brief,
}: CampaignChatPanelProps): ReactElement {
  const modelsQuery = useModels();

  // Seed the opening user turn with this campaign so the strategist's first
  // playbook recall is grounded on it (stable across renders).
  const initialMessages = useMemo(
    () => campaignOpeningMessages(title, brief),
    [title, brief]
  );

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
          Watch the marketing strategist
        </h2>
        <p className="text-muted-foreground text-xs">
          Ask the strategist to critique this campaign — it recalls the brand
          playbook live, so you can watch its knowledge lookups stream inline in
          the thread. Ephemeral session (nothing is saved to your chat history).
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
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
          <ChatRuntimeProvider
            modelRef={modelRef}
            selectedGraph={GROWTH_CHAT_GRAPH_ID}
            defaultModelId={defaultModelId}
            initialMessages={initialMessages}
            initialStateKey={null}
            onAuthExpired={() => signOut()}
          >
            <Thread />
          </ChatRuntimeProvider>
        </div>
      )}
    </section>
  );
}
