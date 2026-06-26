// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/growth/campaigns.shared`
 * Purpose: CLIENT-SAFE growth constants/types shared by the server facade and the
 *   "use client" funnel UI. These carry NO server deps (no db, no LLM, no
 *   bootstrap) so importing them into a client component does not drag Node
 *   built-ins (fs/child_process/dns) into the browser bundle — the build failure
 *   that occurred when the funnel UI imported FUNNEL_LAYERS from campaigns.server.
 * Scope: pure constants + types. No I/O, no imports.
 * Side-effects: none
 * @public
 */

/** The funnel layers, ordered top→bottom. Client-safe (no server deps). */
export const FUNNEL_LAYERS = ["tofu", "mofu", "bofu"] as const;
export type FunnelLayer = (typeof FUNNEL_LAYERS)[number];
