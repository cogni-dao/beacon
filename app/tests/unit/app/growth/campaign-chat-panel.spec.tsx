// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/growth/campaign-chat-panel.spec`
 * Purpose: Proves the campaign chat panel renders a thread-less chat window wired
 *   to the shared ChatRuntimeProvider + reused Thread, targets the growth-chat
 *   graph, stays ephemeral, and seeds the opening turn with the campaign. Tool
 *   usage is rendered by the reused Thread's native ToolFallback (covered by the
 *   shared chat layer), so there is no bespoke tool-feed to test here.
 * Scope: Component-layer (jsdom + testing-library). Mocks the shared chat infra
 *   (provider + Thread) so wiring can be asserted without a live backend.
 * Invariants:
 *   - GROWTH_CHAT_GRAPH: panel targets `langgraph:growth-chat` (NOT generic brain).
 *   - CAMPAIGN_AWARE: panel seeds the opening user turn with the campaign title+brief
 *     and passes null initialStateKey (ephemeral, no thread persistence).
 *   - REUSE_ONLY: renders the reused Thread, no parallel tool widget.
 * Side-effects: none (mocked dependencies)
 * Links: src/app/(app)/growth/_components/CampaignChatPanel.tsx
 * @vitest-environment jsdom
 * @internal
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// --- Mock the shared chat runtime provider (DO-NOT-TOUCH; reuse as-is) ---
// Captures the props the panel passes so we can assert thread-less wiring, and
// renders children so the reused Thread mounts.
const capturedProviderProps: Record<string, unknown> = {};
vi.mock("@/features/ai/chat/providers/ChatRuntimeProvider.client", () => ({
  ChatRuntimeProvider: (props: {
    children: ReactNode;
    initialMessages: unknown[];
    initialStateKey: string | null;
    selectedGraph: string;
    modelRef: { modelId: string };
  }) => {
    Object.assign(capturedProviderProps, props);
    return <div data-testid="runtime-provider">{props.children}</div>;
  },
}));

// --- Mock the kit Thread (vendor assistant-ui; not under test here) ---
vi.mock("@/components", () => ({
  Thread: () => <div data-testid="thread">thread</div>,
}));

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

// Import AFTER mocks are registered.
import { CampaignChatPanel } from "@/app/(app)/growth/_components/CampaignChatPanel";

describe("CampaignChatPanel", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    for (const k of Object.keys(capturedProviderProps))
      delete capturedProviderProps[k];
    vi.clearAllMocks();
  });

  function renderPanel() {
    return render(
      <QueryClientProvider client={queryClient}>
        <CampaignChatPanel
          campaignId="camp-123"
          title="Launch the widget"
          brief="Drive signups for the new widget across the funnel."
        />
      </QueryClientProvider>
    );
  }

  it("shows a loading hint until a server model ref resolves", () => {
    renderPanel();
    expect(screen.queryByTestId("runtime-provider")).toBeNull();
    expect(screen.getByText(/Loading the AI/i)).toBeInTheDocument();
  });

  it("renders a thread-less chat window once a model resolves", async () => {
    queryClient.setQueryData(["ai-models"], {
      models: [
        {
          ref: { providerKey: "platform", modelId: "free-1" },
          requiresPlatformCredits: false,
        },
      ],
      defaultRef: { providerKey: "platform", modelId: "free-1" },
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("runtime-provider")).toBeInTheDocument();
    });
    // Reuses the shared Thread (whose ToolFallback streams tool calls inline).
    expect(screen.getByTestId("thread")).toBeInTheDocument();

    // GROWTH_CHAT wiring: targets the dedicated marketing-strategist graph,
    // ephemeral (null stateKey), and resolves the server model ref.
    expect(capturedProviderProps.selectedGraph).toBe("langgraph:growth-chat");
    expect(capturedProviderProps.initialStateKey).toBeNull();
    expect(
      (capturedProviderProps.modelRef as { modelId: string }).modelId
    ).toBe("free-1");

    // CAMPAIGN_AWARE: the seeded opening user message carries title + brief.
    const seeded = capturedProviderProps.initialMessages as Array<{
      role: string;
      parts: Array<{ type: string; text: string }>;
    }>;
    expect(seeded).toHaveLength(1);
    expect(seeded[0].role).toBe("user");
    const text = seeded[0].parts.map((p) => p.text).join("\n");
    expect(text).toContain("Launch the widget");
    expect(text).toContain("Drive signups for the new widget");
  });
});
