// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/knowledge-base/growth-playbook-seeds`
 * Purpose: Unit-test the v0 marketing-campaign playbook seeds (`GROWTH_PLAYBOOK_SEEDS`)
 *   — prove every atom LOADS and CONFORMS to the knowledge atom shape (domain / entry_type
 *   / title / content / source_type / tags), is GENERIC (names no real account/campaign/post),
 *   targets one of the 3 registered growth domains, has a stable unique id, and that the
 *   example campaign playbooks live in `beacon-brand-voice` so the live RESEARCH/GENERATE
 *   recall (which queries ONLY that domain) can surface them.
 * Scope: Pure data validation against the published Zod schema + the domain registry. No
 *   I/O, no DB, no LLM — the atoms are static catalogue data.
 * Invariants:
 *   - SHAPE_CONFORMS: every atom passes `NewKnowledgeSchema`.
 *   - DOMAIN_REGISTERED: every atom's domain is one of the 3 seeded growth domains.
 *   - GENERIC_ONLY: tagged "generic"; no atom names a real account/campaign/post handle.
 *   - RECALL_LIVES_IN_BRAND_VOICE: the example playbooks are in `beacon-brand-voice`.
 *   - STABLE_UNIQUE_IDS: ids are unique and namespaced `beacon-pb-*`.
 * Side-effects: none
 * Links: packages/knowledge-base/src/seeds/growth-playbook.ts,
 *         docs/research/_knowledge/dolt-playbook-seed.md
 * @internal
 */

import {
	BASE_DOMAIN_SEEDS,
	GROWTH_PLAYBOOK_SEEDS,
} from "@cogni/knowledge-base";
import { NewKnowledgeSchema } from "@cogni/knowledge-store";
import { describe, expect, it } from "vitest";

const GROWTH_DOMAINS = new Set([
	"beacon-brand-voice",
	"beacon-campaigns",
	"beacon-post-performance",
]);

describe("GROWTH_PLAYBOOK_SEEDS — v0 marketing-campaign playbook", () => {
	it("loads a concise, high-signal set of atoms (12-18 + 2 example playbooks)", () => {
		expect(GROWTH_PLAYBOOK_SEEDS.length).toBeGreaterThanOrEqual(12);
		expect(GROWTH_PLAYBOOK_SEEDS.length).toBeLessThanOrEqual(20);
	});

	it("every atom conforms to the knowledge atom shape (NewKnowledgeSchema)", () => {
		for (const atom of GROWTH_PLAYBOOK_SEEDS) {
			const parsed = NewKnowledgeSchema.safeParse(atom);
			expect(
				parsed.success,
				`atom ${atom.id} failed schema: ${
					parsed.success ? "" : JSON.stringify(parsed.error.issues)
				}`,
			).toBe(true);
		}
	});

	it("every atom carries the required atom fields (domain/entry_type/title/content/source_type/tags)", () => {
		for (const atom of GROWTH_PLAYBOOK_SEEDS) {
			expect(atom.domain, `${atom.id} domain`).toBeTruthy();
			expect(atom.entryType, `${atom.id} entryType`).toBeTruthy();
			expect(atom.title.trim().length, `${atom.id} title`).toBeGreaterThan(0);
			expect(atom.content.trim().length, `${atom.id} content`).toBeGreaterThan(
				0,
			);
			expect(atom.sourceType, `${atom.id} sourceType`).toBeTruthy();
			expect(
				Array.isArray(atom.tags) && atom.tags.length > 0,
				`${atom.id} tags`,
			).toBe(true);
		}
	});

	it("every atom targets one of the 3 registered growth domains", () => {
		const registered = new Set(BASE_DOMAIN_SEEDS.map((d) => d.id));
		for (const atom of GROWTH_PLAYBOOK_SEEDS) {
			expect(GROWTH_DOMAINS.has(atom.domain), `${atom.id} domain`).toBe(true);
			// and that domain is actually registered in the base domain seeds
			expect(registered.has(atom.domain), `${atom.id} domain registered`).toBe(
				true,
			);
		}
	});

	it("every atom is GENERIC — tagged generic, no real handles/URLs/@-mentions", () => {
		for (const atom of GROWTH_PLAYBOOK_SEEDS) {
			expect(atom.tags, `${atom.id} generic tag`).toContain("generic");
			const blob = `${atom.title} ${atom.content}`;
			// A generic atom names no real account/post — no @-handles or URLs.
			expect(/@[A-Za-z0-9_]{2,}/.test(blob), `${atom.id} has @-handle`).toBe(
				false,
			);
			expect(/https?:\/\//.test(blob), `${atom.id} has URL`).toBe(false);
		}
	});

	it("ids are unique and namespaced beacon-pb-*", () => {
		const ids = GROWTH_PLAYBOOK_SEEDS.map((a) => a.id);
		expect(new Set(ids).size, "unique ids").toBe(ids.length);
		for (const id of ids) {
			expect(id.startsWith("beacon-pb-"), `id ${id} namespaced`).toBe(true);
		}
	});

	it("covers all 3 growth domains (compounding memory for each)", () => {
		const domains = new Set(GROWTH_PLAYBOOK_SEEDS.map((a) => a.domain));
		expect(domains).toEqual(GROWTH_DOMAINS);
	});

	it("ships >=2 choosable example playbooks IN beacon-brand-voice (the recalled domain)", () => {
		const playbooks = GROWTH_PLAYBOOK_SEEDS.filter((a) =>
			a.tags?.includes("example-playbook"),
		);
		expect(playbooks.length).toBeGreaterThanOrEqual(2);
		for (const pb of playbooks) {
			// RECALL_LIVES_IN_BRAND_VOICE: only this domain is recalled by the live loop,
			// so a choosable playbook must live here to be selectable at GENERATE time.
			expect(pb.domain, `${pb.id} playbook domain`).toBe("beacon-brand-voice");
		}
	});

	it("each example playbook bundles all five components in its content", () => {
		const playbooks = GROWTH_PLAYBOOK_SEEDS.filter((a) =>
			a.tags?.includes("example-playbook"),
		);
		for (const pb of playbooks) {
			const c = pb.content.toUpperCase();
			for (const marker of ["FUNNEL", "VOICE", "HOOK", "CADENCE", "METRIC"]) {
				expect(c.includes(marker), `${pb.id} mentions ${marker}`).toBe(true);
			}
		}
	});
});
