// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/tool-feed/useToolFeed`
 * Purpose: Bridge between the live assistant-ui runtime and the pure tool-feed.
 *   Reads the running thread's messages + isRunning flag from the runtime and
 *   derives the ToolFeedItem[] that ToolFeed renders. Must be called inside an
 *   AssistantRuntimeProvider (i.e. inside ChatRuntimeProvider).
 * Scope: Thin selector hook. All shaping logic lives in deriveToolFeed (pure).
 * Side-effects: subscribes to assistant-ui thread state.
 * Links: ./deriveToolFeed.ts, src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx
 * @internal
 */

"use client";

import { useThread } from "@assistant-ui/react";

import { deriveToolFeed, type ToolFeedItem } from "./deriveToolFeed";

export interface ToolFeedState {
  items: ToolFeedItem[];
  isRunning: boolean;
}

/** Derive the live tool-usage feed from the active assistant-ui thread. */
export function useToolFeed(): ToolFeedState {
  const items = useThread((t) => deriveToolFeed(t.messages));
  const isRunning = useThread((t) => t.isRunning);
  return { items, isRunning };
}
