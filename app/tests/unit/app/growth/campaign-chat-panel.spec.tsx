// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/growth/campaign-chat-panel.spec`
 * Purpose: Proves the campaign chat panel (1) renders a thread-less chat window
 *   wired to the shared ChatRuntimeProvider, and (2) renders a LIVE TOOL-USAGE
 *   FEED when fed mock streamed tool events (tool-input-start /
 *   tool-input-available / tool-output-available) plus a data-status event.
 * Scope: Component-layer (jsdom + testing-library). Mocks the shared chat infra
 *   and the assistant-ui useThread selector so the feed can be driven by mock
 *   messages without a live backend — exactly the streamed events the chat route
 *   emits, reshaped into assistant-ui ThreadMessage parts.
 * Invariants:
 *   - GROWTH_CHAT_GRAPH: panel targets `langgraph:growth-chat` (NOT generic brain).
 *   - CAMPAIGN_AWARE: panel seeds the opening user turn with the campaign title+brief
 *     and passes null initialStateKey (ephemeral, no thread persistence).
 *   - TOOL_FEED_RENDERS: streamed tool events surface as feed rows with state.
 * Side-effects: none (mocked dependencies)
 * Links: src/app/(app)/growth/_components/CampaignChatPanel.tsx,
 *   src/app/(app)/growth/_components/tool-feed/deriveToolFeed.ts
 * @vitest-environment jsdom
 * @internal
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { ThreadMessage } from "@assistant-ui/react";

import {
  deriveToolFeed,
  type ToolFeedItem,
} from "@/app/(app)/growth/_components/tool-feed/deriveToolFeed";

/** Build mock assistant-ui thread messages without restating the full shape. */
function msgs(items: Array<{ role: string; content: unknown[] }>) {
  return items as unknown as ThreadMessage[];
}

// --- Mock the shared chat runtime provider (DO-NOT-TOUCH; reuse as-is) ---
// Captures the props the panel passes so we can assert thread-less wiring, and
// renders children so the inner ChatPanelBody (which calls useToolFeed) mounts.
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

// --- Mock the assistant-ui useThread selector that useToolFeed reads ---
// The mock thread state is built FROM mock streamed events (see buildThread).
let mockThreadState: { messages: unknown[]; isRunning: boolean };
vi.mock("@assistant-ui/react", () => ({
  useThread: <T,>(selector: (s: typeof mockThreadState) => T): T =>
    selector(mockThreadState),
}));

// --- Mock the kit Thread (vendor assistant-ui; not under test here) ---
vi.mock("@/components", () => ({
  Thread: () => <div data-testid="thread">thread</div>,
}));

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

// Import AFTER mocks are registered.
import { CampaignChatPanel } from "@/app/(app)/growth/_components/CampaignChatPanel";

/**
 * Reshape the chat route's streamed tool events into an assistant-ui
 * ThreadMessage. Mirrors the real stream lifecycle:
 *   tool-input-start    → tool-call part appears (running, no result)
 *   tool-input-available→ args populated
 *   tool-output-available→ result populated (done)
 * Plus a transient data-status part.
 */
function buildThread(opts: {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  statusPhase?: string;
  statusLabel?: string;
}) {
  const content: unknown[] = [
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: opts.toolName,
      args: opts.args,
      argsText: JSON.stringify(opts.args),
      ...(opts.result !== undefined ? { result: opts.result } : {}),
    },
  ];
  if (opts.statusPhase) {
    content.push({
      type: "data",
      name: "status",
      data: { phase: opts.statusPhase, label: opts.statusLabel },
    });
  }
  return {
    messages: [{ role: "assistant", content }],
    isRunning: opts.result === undefined,
  };
}

describe("deriveToolFeed (pure)", () => {
  it("turns a streamed tool lifecycle into feed items", () => {
    // input-start + input-available, no output yet → running
    const running = deriveToolFeed(
      msgs([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "web_search",
              args: { query: "cogni dao" },
              argsText: '{"query":"cogni dao"}',
            },
          ],
        },
      ])
    );
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject<Partial<ToolFeedItem>>({
      kind: "tool",
      label: "web_search",
      state: "running",
    });
    expect(running[0].detail).toContain("cogni dao");

    // output-available → done with result
    const done = deriveToolFeed(
      msgs([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "web_search",
              args: { query: "cogni dao" },
              argsText: "",
              result: { hits: 3 },
            },
          ],
        },
      ])
    );
    expect(done[0].state).toBe("done");
    expect(done[0].result).toContain("hits");
  });

  it("renders a data-status row and marks errors", () => {
    const feed = deriveToolFeed(
      msgs([
        {
          role: "assistant",
          content: [
            {
              type: "data",
              name: "status",
              data: { phase: "researching", label: "Searching the web" },
            },
            {
              type: "tool-call",
              toolCallId: "c2",
              toolName: "fetch",
              args: {},
              argsText: "",
              result: "boom",
              isError: true,
            },
          ],
        },
      ])
    );
    const status = feed.find((f) => f.kind === "status");
    expect(status?.detail).toBe("Searching the web");
    const tool = feed.find((f) => f.kind === "tool");
    expect(tool?.state).toBe("error");
  });

  it("ignores user messages", () => {
    const feed = deriveToolFeed(
      msgs([{ role: "user", content: [{ type: "text", text: "hi" }] }])
    );
    expect(feed).toHaveLength(0);
  });
});

describe("CampaignChatPanel", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockThreadState = { messages: [], isRunning: false };
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
    expect(screen.getByTestId("thread")).toBeInTheDocument();

    // GROWTH_CHAT wiring: targets the dedicated marketing-strategist graph,
    // ephemeral (null stateKey), and seeds the opening turn with campaign context.
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

  it("renders the live tool feed when fed mock streamed tool events", async () => {
    queryClient.setQueryData(["ai-models"], {
      models: [
        {
          ref: { providerKey: "platform", modelId: "free-1" },
          requiresPlatformCredits: false,
        },
      ],
      defaultRef: { providerKey: "platform", modelId: "free-1" },
    });

    // Mock streamed tool usage: web_search running + a status phase.
    mockThreadState = buildThread({
      toolName: "web_search",
      args: { query: "cogni growth" },
      statusPhase: "researching",
      statusLabel: "Searching the web",
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("tool-feed")).toBeInTheDocument();
    });

    // The tool row shows the tool name + args summary, running state.
    const toolRow = screen.getByTestId("tool-feed-tool");
    expect(toolRow).toHaveAttribute("data-state", "running");
    expect(toolRow).toHaveTextContent("web_search");
    expect(toolRow).toHaveTextContent("cogni growth");

    // The data-status row surfaces too.
    expect(screen.getByTestId("tool-feed-status")).toHaveTextContent(
      "Searching the web"
    );

    // Header reflects the running state.
    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});
