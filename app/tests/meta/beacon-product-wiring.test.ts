// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/meta/beacon-product-wiring`
 * Purpose: Guard Beacon's node-owned product composition against generic scaffold replacement.
 * Scope: Source-level conformance for user entrypoints, identity, knowledge domains, and credential decoding.
 * Invariants: SOCIAL_CONNECTIONS_REACHABLE, BEACON_IDENTITY_VISIBLE, BEACON_KNOWLEDGE_SEEDED.
 * Side-effects: IO (reads repository source files).
 * Links: bug.5305
 * @internal
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

describe("Beacon product wiring", () => {
  it("keeps social connection controls rendered on the profile", () => {
    const profile = readRepoFile("app/src/app/(app)/profile/view.tsx");

    for (const endpoint of [
      "/api/v1/connections/x/connect",
      "/api/v1/connections/x/status",
      "/api/v1/connections/moltbook/connect",
      "/api/v1/connections/moltbook/status",
      "/api/v1/connections/sandbox/connect",
      "/api/v1/connections/sandbox/post",
    ]) {
      expect(profile).toContain(endpoint);
    }
    expect(profile).toContain("<SectionHeading>Social Accounts</SectionHeading>");
  });

  it("keeps Beacon identity and Growth reachable", () => {
    const sidebar = readRepoFile(
      "app/src/features/layout/components/AppSidebar.tsx"
    );
    const layout = readRepoFile("app/src/app/layout.tsx");
    const thread = readRepoFile(
      "app/src/components/vendor/assistant-ui/thread.tsx"
    );

    expect(sidebar).toContain('href: "/growth"');
    expect(sidebar).toContain("cogni/beacon");
    expect(layout).toContain("Cogni Beacon — the AI that grows every Cogni node");
    expect(thread).toContain("What should we broadcast today?");
  });

  it("keeps Beacon secrets, knowledge domains, and review mission declared", () => {
    const secrets = readRepoFile(".cogni/secrets-catalog.yaml");
    // Node-owned: the beacon domains moved out of the shared (now published +
    // vendored-no-more) `@cogni/knowledge-base` package into this node's own
    // Doltgres schema package.
    const domains = readRepoFile("packages/doltgres-schema/src/domains.ts");
    const goalRule = readRepoFile(".cogni/rules/repo-goal-alignment.yaml");

    for (const secret of [
      "X_API_BEARER_TOKEN",
      "X_OAUTH_CLIENT_ID",
      "X_OAUTH_CLIENT_SECRET",
    ]) {
      expect(secrets).toContain(`name: ${secret}`);
    }
    for (const domain of [
      "beacon-campaigns",
      "beacon-post-performance",
      "beacon-brand-voice",
    ]) {
      expect(domains).toContain(`id: "${domain}"`);
    }
    expect(goalRule).toContain("beacon's growth-loop mission");
  });

  it("keeps both BYO-AI credential routes on the shared AEAD decoder", () => {
    for (const route of [
      "app/src/app/api/v1/auth/openai-codex/exchange/route.ts",
      "app/src/app/api/v1/auth/openai-compatible/connect/route.ts",
    ]) {
      const source = readRepoFile(route);
      expect(source).toContain("decodeAeadKey");
      expect(source).not.toContain('Buffer.from(encryptionKey, "hex")');
      expect(source).not.toContain('Buffer.from(encKeyHex, "hex")');
    }
  });
});
