// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/public`
 * Purpose: Node-local core entry point. Re-exports shared platform core from @cogni/node-core. Nodes extend this with node-specific domain models.
 * Scope: Re-export barrel + node-specific extensions. Does NOT duplicate platform core logic.
 * Invariants: Re-exports @cogni/node-core platform surface; node-specific named exports below
 * Side-effects: none
 * Links: @cogni/node-core, docs/spec/node-app-shell.md
 * @public
 */

// Shared platform core — all nodes get these
export * from "@cogni/node-core";

// Node-specific core domain goes below this line.

// Beacon growth loop — the pure, independent engagement VERIFIER. Beacon-owned:
// it used to live in the vendored `@cogni/knowledge-store` copy, which is now a
// published node-template tarball that must not carry per-node logic.
export {
  computeEngagementKpi,
  type EngagementBasis,
  type EngagementKpiResult,
  type EngagementTarget,
  EngagementTargetSchema,
  type PostMetricSnapshot,
  PostMetricSnapshotSchema,
} from "./growth/engagement-kpi";
