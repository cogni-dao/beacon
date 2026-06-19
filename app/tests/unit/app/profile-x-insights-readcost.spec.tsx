// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/profile-x-insights-readcost`
 * Purpose: The profile X insights card serves the route's cached snapshot on
 *   mount (the plain, $0 GET) and only hits the PAID `?refresh=1` path on an
 *   explicit Refresh click. The real cost boundary is the route — guarded
 *   separately in connections-metrics-readcost.spec.ts — but the UI must not
 *   reach for the paid path on render.
 * Scope: Unit test for src/app/(app)/profile/view.tsx metrics fetch behavior.
 * Invariants: INV-READCOST-NO-PAID-FETCH-ON-RENDER — the card never requests
 *   `?refresh=1` during mount; exactly one such request per explicit refresh.
 * Side-effects: none (mocked fetch + boundaries)
 * Links: src/app/(app)/profile/view.tsx, docs/spec/platform-connections.md
 * @vitest-environment jsdom
 * @internal
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// ── Boundary mocks (heavy providers the view pulls in) ──────────────────
vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { walletAddress: "0xabc0000000000000000000000000000000000001" },
    },
    update: vi.fn(),
  }),
  signIn: vi.fn(),
}));

// Minimal component stand-ins so the view renders without the real UI kit.
vi.mock("@/components", () => {
  const Passthrough = (props: { children?: React.ReactNode }) => (
    <div>{props.children}</div>
  );
  const Icon = () => <svg />;
  return {
    Avatar: Passthrough,
    AvatarFallback: Passthrough,
    Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props} />
    ),
    DiscordIcon: Icon,
    EthereumIcon: Icon,
    GitHubIcon: Icon,
    GoogleIcon: Icon,
    PageContainer: Passthrough,
    XIcon: Icon,
  };
});

vi.mock("@/features/ai/icons/providers/OpenAIIcon", () => ({
  OpenAIIcon: () => <svg />,
}));

import { ProfileView } from "@/app/(app)/profile/view";

const snapshot = (followers: number) => ({
  linked: true,
  status: "active",
  metrics: {
    profile: {
      externalAccountId: "1",
      handle: "@me",
      displayName: "Me",
      followers,
    },
    recentPosts: [],
    fetchedAt: new Date().toISOString(),
  },
});

/** Fetch mock that records calls and answers the mount status probes. */
function installFetchMock(): { calls: string[] } {
  const calls: string[] = [];
  const json = (body: unknown) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);

  const handler = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.endsWith("/api/v1/connections/x/status")) {
      return json({ connected: true, accounts: [{ handle: "@me" }] });
    }
    if (
      url.endsWith("/api/v1/connections/moltbook/status") ||
      url.endsWith("/api/v1/connections/sandbox/status")
    ) {
      return json({ connected: false, accounts: [] });
    }
    if (url.endsWith("/api/v1/users/me")) {
      return json({
        displayName: "Me",
        avatarColor: null,
        resolvedDisplayName: "Me",
        linkedProviders: [],
      });
    }
    if (url.endsWith("/api/auth/providers")) {
      return json({});
    }
    // The metrics route: plain GET = cached snapshot ($0); ?refresh=1 = paid read.
    if (url.includes("/api/v1/connections/x/metrics")) {
      return json(url.includes("refresh=1") ? snapshot(43) : snapshot(42));
    }
    // ownership, codex/status, openai-compatible/status …
    return json({ connected: false });
  };

  vi.stubGlobal("fetch", vi.fn(handler));
  return { calls };
}

/** Render the view inside a fresh QueryClient (the card uses useQuery). */
function renderView(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileView />
    </QueryClientProvider>
  );
}

const refreshCalls = (calls: string[]) =>
  calls.filter((u) => u.includes("/x/metrics") && u.includes("refresh=1"));

describe("Profile X insights — read-cost discipline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the cached snapshot on mount WITHOUT hitting the paid refresh path", async () => {
    const { calls } = installFetchMock();

    renderView();

    // The cheap cached GET populates the card on mount.
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    // The plain GET happened; the paid ?refresh=1 path did NOT.
    expect(calls.some((u) => u.includes("/x/metrics"))).toBe(true);
    expect(refreshCalls(calls)).toHaveLength(0);
  });

  it("hits ?refresh=1 exactly once on an explicit refresh click", async () => {
    const { calls } = installFetchMock();

    renderView();
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText("43")).toBeInTheDocument(); // fresh follower count
    });

    expect(refreshCalls(calls)).toHaveLength(1);
  });
});
