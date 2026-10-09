// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@cogni/node-template-doltgres-schema/domains`
 * Purpose: Beacon's node-owned `domains` registry seeds. Composes the universal
 *   baseline inherited from `@cogni/knowledge-base` with the beacon-specific
 *   subject-matter domains the growth loop writes into.
 * Scope: Seed data definitions only. Does not perform I/O — the migrator (or the
 *   first-write path) applies these.
 * Invariants:
 *   - NODE_OWNS_ITS_DOMAINS: niche/subject-matter domains belong to the node, not
 *     to the shared `@cogni/knowledge-base` package ("Domain-specific extensions
 *     go in the node's own package"). The shared package is now consumed as a
 *     published node-template tarball, so it cannot carry beacon rows.
 *   - BASE_FIRST_APPEND_ONLY: the universal baseline comes first and node domains
 *     are appended; domain `id`s are stable identifiers.
 * Side-effects: none
 * Links: docs/spec/knowledge-syntropy.md, docs/spec/beacon-growth-loop-v0.md
 * @public
 */

import { BASE_DOMAIN_SEEDS } from "@cogni/knowledge-base";
import type { NewDomain } from "@cogni/knowledge-store";

/**
 * Domains owned by this node. The three `beacon-*` rows are load-bearing for the
 * growth loop (campaign hypotheses, post-performance findings, brand-voice
 * rules). The remainder predate the node-owned split and are kept so a fresh
 * Doltgres init registers exactly the same set as today.
 */
export const NODE_DOMAIN_SEEDS: NewDomain[] = [
  {
    id: "prediction-market",
    name: "Prediction Markets",
    description:
      "Polymarket and adjacent prediction-market knowledge — base rates, market structure, calibration.",
  },
  {
    id: "infrastructure",
    name: "Infrastructure",
    description:
      "Runtime, deploy, observability, and capacity knowledge for Cogni nodes.",
  },
  {
    id: "governance",
    name: "Governance",
    description:
      "DAO formation, attribution, voting, and operator/node contracts.",
  },
  {
    id: "reservations",
    name: "Reservations",
    description:
      "Restaurant / venue reservation knowledge for the resy node domain.",
  },
  {
    id: "beacon-campaigns",
    name: "Beacon Campaigns",
    description:
      "Growth-campaign hypotheses (metric:engagement) and their resolved outcomes for the beacon growth loop.",
  },
  {
    id: "beacon-post-performance",
    name: "Beacon Post Performance",
    description:
      "Per-post / per-angle engagement findings that serve as evidence_for beacon campaign hypotheses.",
  },
  {
    id: "beacon-brand-voice",
    name: "Beacon Brand Voice",
    description:
      "Durable brand-voice rules — winning hooks, angles, formats, and timing per audience + channel. Every PLAN recalls this domain.",
  },
];

/** Universal baseline + this node's own domains, in registration order. */
export const DOMAIN_SEEDS: NewDomain[] = [
  ...BASE_DOMAIN_SEEDS,
  ...NODE_DOMAIN_SEEDS,
];
