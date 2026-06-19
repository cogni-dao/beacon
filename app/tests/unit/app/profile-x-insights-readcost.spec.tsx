// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/profile-x-insights-readcost`
 * Purpose: Lock the read-cost invariant on the profile X insights card — the paid
 *   X metrics read MUST NOT fire on passive render; it fires only on an explicit
 *   user action (the Refresh / Load button).
 * Scope: Unit test for src/app/(app)/profile/view.tsx metrics fetch behavior.
 *   Does not test OAuth linking, the broker, or the live X adapter.
 * Invariants: INV-READCOST-NO-FETCH-ON-RENDER — GET /api/v1/connections/x/metrics
 *   is never called during mount; exactly one call per explicit refresh.
 * Side-effects: none (mocked fetch + boundaries)
 * Links: src/app/(app)/profile/view.tsx, docs/spec/platform-connections.md
 * @vitest-environment jsdom
 * @internal
 */

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

/** Build a fetch mock that records calls and answers the mount status probes. */
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
    if (url.endsWith("/api/v1/connections/x/metrics")) {
      return json({
        linked: true,
        metrics: {
          profile: {
            externalAccountId: "1",
            handle: "@me",
            displayName: "Me",
            followers: 42,
          },
          recentPosts: [],
          fetchedAt: new Date().toISOString(),
        },
      });
    }
    // ownership, codex/status, openai-compatible/status …
    return json({ connected: false });
  };

  vi.stubGlobal("fetch", vi.fn(handler));
  return { calls };
}

describe("Profile X insights — read-cost discipline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("does NOT call the paid X metrics read on passive render", async () => {
    const { calls } = installFetchMock();

    render(<ProfileView />);

    // Wait until the connection-status probes have settled and the card is shown.
    await waitFor(() => {
      expect(screen.getByText("X insights")).toBeInTheDocument();
    });

    // The whole point: zero metrics calls during mount + status hydration.
    expect(calls.filter((u) => u.endsWith("/x/metrics"))).toHaveLength(0);
    // The card invites an explicit load rather than auto-fetching.
    expect(
      screen.getByRole("button", { name: /load insights/i })
    ).toBeInTheDocument();
  });

  it("fetches X metrics exactly once on an explicit refresh click", async () => {
    const { calls } = installFetchMock();

    render(<ProfileView />);
    await waitFor(() => {
      expect(screen.getByText("X insights")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /load insights/i }));

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument(); // follower count rendered
    });

    expect(calls.filter((u) => u.endsWith("/x/metrics"))).toHaveLength(1);
  });
});
