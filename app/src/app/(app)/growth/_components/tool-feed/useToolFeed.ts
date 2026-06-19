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
import { useMemo } from "react";

import { deriveToolFeed, type ToolFeedItem } from "./deriveToolFeed";

export interface ToolFeedState {
  items: ToolFeedItem[];
  isRunning: boolean;
}

/** Derive the live tool-usage feed from the active assistant-ui thread. */
export function useToolFeed(): ToolFeedState {
  // Select the STABLE `messages` reference — never derive inside the selector.
  // `deriveToolFeed` allocates a fresh array on every call, so selecting its
  // result directly defeats useThread's Object.is change check → the store
  // thinks state changed every render → infinite re-render loop (React #185,
  // which crashed the campaign page live). Select the raw messages (identity is
  // stable until they actually change), then derive in a memo keyed on it.
  const messages = useThread((t) => t.messages);
  const isRunning = useThread((t) => t.isRunning);
  const items = useMemo(() => deriveToolFeed(messages), [messages]);
  return { items, isRunning };
}
