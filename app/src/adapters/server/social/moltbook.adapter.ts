// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/social/moltbook.adapter`
 * Purpose: Moltbook data-plane adapter implementing SocialXCapability for a
 *   single tenant-linked Moltbook agent API key.
 * Scope: Post text content and read post engagement snapshots from Moltbook's
 *   public v1 API. Does not resolve credentials, touch Postgres, or schedule work.
 * Invariants:
 *   - TENANT_TOKEN_AT_CONSTRUCTION: constructed only after the caller resolves a
 *     tenant's active Moltbook connection via ConnectionBrokerPort.
 *   - MOLTBOOK_WWW_BASE: default API base uses `www.moltbook.com`; bare-domain
 *     redirects can strip Authorization.
 *   - TOKENS_NEVER_LOGGED: access token and post body never appear in logs/errors.
 *   - VERIFICATION_NOT_SOLVED: anti-spam challenges are surfaced as explicit
 *     failures for the queue/manual retry path; the adapter never auto-solves them.
 * Side-effects: IO (HTTPS requests to Moltbook).
 * Links: https://www.moltbook.com/skill.md
 * @internal
 */

import type {
	PostContentInput,
	PostContentResult,
	PostMetricSnapshot,
	SocialXCapability,
} from "@cogni/ai-tools";
import {
	MoltbookPostPayloadSchema,
	PostContentResultSchema,
	PostMetricSnapshotSchema,
} from "@cogni/ai-tools";
import { z } from "zod";

import { EVENT_NAMES, makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "MoltbookSocialAdapter" });

/** Official Moltbook API base. Use `www` to avoid auth-stripping redirects. */
export const DEFAULT_MOLTBOOK_API_BASE_URL =
	"https://www.moltbook.com/api/v1" as const;

const DEFAULT_SUBMOLT = "general";
const DEFAULT_TIMEOUT_MS = 10000;

const UnknownRecordSchema = z.record(z.string(), z.unknown());

const MoltbookCreatePostResponseSchema = z
	.object({
		success: z.boolean().optional(),
		verification_required: z.boolean().optional(),
		verification: z.unknown().optional(),
		post: UnknownRecordSchema.optional(),
		data: UnknownRecordSchema.optional(),
		id: z.union([z.string(), z.number()]).optional(),
		post_id: z.union([z.string(), z.number()]).optional(),
		url: z.string().url().optional(),
		post_url: z.string().url().optional(),
		permalink: z.string().url().optional(),
		created_at: z.string().optional(),
	})
	.passthrough();

const MoltbookPostResponseSchema = z
	.object({
		post: UnknownRecordSchema.optional(),
		data: UnknownRecordSchema.optional(),
	})
	.passthrough();

const MoltbookCommentsResponseSchema = z
	.object({
		comments: z.array(z.unknown()).optional(),
		count: z.number().int().nonnegative().optional(),
	})
	.passthrough();

export interface MoltbookSocialConfig {
	/** Tenant-linked Moltbook agent API key. */
	accessToken: string;
	/** Override the API base (default: https://www.moltbook.com/api/v1). */
	apiBaseUrl?: string;
	/** Default submolt used for text posts (default: general). */
	submoltName?: string;
	/** Request timeout in milliseconds (default: 10000). */
	timeoutMs?: number;
}

export class MoltbookVerificationRequiredError extends Error {
	constructor() {
		super("Moltbook post requires verification challenge");
		this.name = "MoltbookVerificationRequiredError";
	}
}

export class MoltbookSocialAdapter implements SocialXCapability {
	private readonly accessToken: string;
	private readonly baseUrl: string;
	private readonly submoltName: string;
	private readonly timeoutMs: number;

	constructor(config: MoltbookSocialConfig) {
		this.accessToken = config.accessToken;
		this.baseUrl = (
			config.apiBaseUrl ?? DEFAULT_MOLTBOOK_API_BASE_URL
		).replace(/\/$/, "");
		this.submoltName = config.submoltName ?? DEFAULT_SUBMOLT;
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	async postContent(input: PostContentInput): Promise<PostContentResult> {
		if (input.channel !== "moltbook") {
			throw new Error(
				`MoltbookSocialAdapter only handles channel "moltbook", got "${input.channel}"`,
			);
		}

		const payload = MoltbookPostPayloadSchema.parse({
			...input.moltbook,
			submoltName: input.moltbook?.submoltName ?? this.submoltName,
		});
		const body = {
			submolt_name: payload.submoltName,
			title: payload.title,
			content: payload.content,
			type: payload.type,
		};
		const startedAt = Date.now();
		let json: unknown;
		try {
			json = await this.requestJson("/posts", {
				method: "POST",
				body: JSON.stringify(body),
			});
		} catch (error) {
			logMoltbookAdapterError("post_failed", startedAt, error);
			throw error;
		}
		const parsed = MoltbookCreatePostResponseSchema.parse(json);
		if (parsed.verification_required || parsed.verification) {
			logMoltbookAdapterError("post_verification_required", startedAt);
			throw new MoltbookVerificationRequiredError();
		}

		const record = parsed.post ?? parsed.data ?? parsed;
		const externalId = stringField(record, ["id", "post_id", "uuid"]);
		if (!externalId) {
			logMoltbookAdapterError("post_response_missing_id", startedAt);
			throw new Error("Moltbook create-post response did not include a post id");
		}

		return PostContentResultSchema.parse({
			externalId,
			url:
				stringField(record, ["url", "post_url", "permalink"]) ??
				parsed.url ??
				parsed.post_url ??
				parsed.permalink ??
				moltbookPostUrl(externalId),
			postedAt:
				stringField(record, ["created_at", "createdAt"]) ??
				parsed.created_at ??
				new Date().toISOString(),
		});
	}

	async readMetrics(
		externalIds: readonly string[],
	): Promise<PostMetricSnapshot[]> {
		const snapshots: PostMetricSnapshot[] = [];
		for (const externalId of externalIds) {
			const snapshot = await this.readOneMetric(externalId);
			if (snapshot) snapshots.push(snapshot);
		}
		return snapshots;
	}

	private async readOneMetric(
		externalId: string,
	): Promise<PostMetricSnapshot | null> {
		let postJson: unknown;
		try {
			postJson = await this.requestJson(`/posts/${encodeURIComponent(externalId)}`);
		} catch (error) {
			if (error instanceof MoltbookHttpError && error.status === 404) {
				return null;
			}
			throw error;
		}

		const parsed = MoltbookPostResponseSchema.parse(postJson);
		const post = parsed.post ?? parsed.data ?? asRecord(postJson);
		if (!post) return null;

		const replies =
			numberField(post, [
				"comment_count",
				"comments_count",
				"comments",
				"reply_count",
				"replies_count",
			]) ?? (await this.readCommentCount(externalId));

		const fetchedAt = new Date().toISOString();
		const followers = numberField(post, ["follower_count", "followers"]);
		return PostMetricSnapshotSchema.parse({
			externalId,
			channel: "moltbook",
			likes: numberField(post, ["upvotes", "upvote_count", "score", "karma"]) ?? 0,
			reposts: 0,
			replies: replies ?? 0,
			fetchedAt,
			...(followers != null ? { followers } : {}),
		});
	}

	private async readCommentCount(externalId: string): Promise<number | null> {
		const startedAt = Date.now();
		try {
			const json = await this.requestJson(
				`/posts/${encodeURIComponent(externalId)}/comments?sort=best&limit=100`,
			);
			const parsed = MoltbookCommentsResponseSchema.parse(json);
			return parsed.count ?? parsed.comments?.length ?? null;
		} catch (error) {
			if (error instanceof MoltbookHttpError && error.status === 404) {
				return null;
			}
			logger.warn(
				{
					event: EVENT_NAMES.ADAPTER_MOLTBOOK_ERROR,
					dep: "moltbook",
					reasonCode: "comments_read_failed",
					durationMs: Date.now() - startedAt,
					...(error instanceof MoltbookHttpError ? { status: error.status } : {}),
				},
				EVENT_NAMES.ADAPTER_MOLTBOOK_ERROR,
			);
			return null;
		}
	}

	private async requestJson(
		path: string,
		init: Omit<RequestInit, "headers" | "signal"> = {},
	): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const res = await fetch(`${this.baseUrl}${path}`, {
				...init,
				headers: {
					Authorization: `Bearer ${this.accessToken}`,
					Accept: "application/json",
					...(init.body ? { "Content-Type": "application/json" } : {}),
				},
				signal: controller.signal,
			});
			if (!res.ok) {
				throw new MoltbookHttpError(res.status);
			}
			return await res.json();
		} finally {
			clearTimeout(timer);
		}
	}
}

class MoltbookHttpError extends Error {
	constructor(readonly status: number) {
		super(`Moltbook request failed (HTTP ${status})`);
		this.name = "MoltbookHttpError";
	}
}

function logMoltbookAdapterError(
	reasonCode:
		| "post_failed"
		| "post_response_missing_id"
		| "post_verification_required",
	startedAt: number,
	error?: unknown,
): void {
	logger.warn(
		{
			event: EVENT_NAMES.ADAPTER_MOLTBOOK_ERROR,
			dep: "moltbook",
			reasonCode,
			durationMs: Date.now() - startedAt,
			...(error instanceof MoltbookHttpError ? { status: error.status } : {}),
		},
		EVENT_NAMES.ADAPTER_MOLTBOOK_ERROR,
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringField(
	record: Record<string, unknown>,
	keys: readonly string[],
): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
	return null;
}

function moltbookPostUrl(externalId: string): string {
	return `https://www.moltbook.com/posts/${encodeURIComponent(externalId)}`;
}

function numberField(
	record: Record<string, unknown>,
	keys: readonly string[],
): number | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}
