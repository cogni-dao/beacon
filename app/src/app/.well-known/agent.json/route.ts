// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/.well-known/agent.json`
 * Purpose: Discovery document for machine agents — publishes the register,
 *   runs, runStream, and completions URLs plus the auth scheme so external
 *   clients can bootstrap without hard-coding paths or reading docs.
 * Scope: Single GET handler. Honors `x-forwarded-host`/`x-forwarded-proto`
 *   from Caddy / k8s ingress so the published URLs are externally reachable
 *   (falling back to the raw Host header then request.url for local dev).
 *   Public endpoint — no auth.
 * Invariants:
 *   - NO_INTERNAL_BIND_ADDR: URLs must never expose `0.0.0.0:3000` or other
 *     in-pod addresses. Always derive origin from forwarded headers first.
 * Side-effects: none
 * Links: docs/guides/agent-api-validation.md
 * @public
 */

import { REVOCABLE_KEY_PREFIX } from "@cogni/agent-grants/credentials";
import { CORE_TOOL_BUNDLE } from "@cogni/ai-tools";
import {
	agentAccessRequestCreateOperation,
	agentAccessRequestListOperation,
	confirmAgentCredentialOperation,
	knowledgeHistoryOperation,
	registerAgentOperation,
	revokeAgentCredentialOperation,
	rotateAgentCredentialOperation,
	upgradeAgentCredentialOperation,
	workItemsClaimOperation,
	workItemsCoordinationOperation,
	workItemsCreateOperation,
	workItemsDeleteOperation,
	workItemsGetOperation,
	workItemsHeartbeatOperation,
	workItemsHistoryOperation,
	workItemsListOperation,
	workItemsPatchOperation,
	workItemsReleaseOperation,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
	buildPermissionCatalog,
	buildRequiresById,
} from "@/bootstrap/agent-permissions";
import {
	getNodeBrandColor,
	getNodeBrandIcon,
	getNodeHook,
	getNodeMission,
	getNodeName,
	getNodeThumbnail,
} from "@/shared/config/repoSpec.server";
import { serverEnv } from "@/shared/env";

export const runtime = "nodejs";

/**
 * JSON Schema for a contract. `unrepresentable: "any"` keeps a field the node validates with a custom zod check
 * (the evaluation `scores` object, `z.custom`) as an open schema, instead of making `z.toJSONSchema` throw: that
 * throw turned every GET of this document into HTTP 500 (the whole actions block is built eagerly).
 */
function toJsonSchema(schema: z.ZodType): ReturnType<typeof z.toJSONSchema> {
  return z.toJSONSchema(schema, { unrepresentable: "any" });
}
/**
 * Resolve the public origin this request reached us through. In prod the app
 * runs behind Caddy / k8s ingress, so Next.js's `request.url` exposes the
 * in-pod bind address (e.g. `http://0.0.0.0:3000`) rather than the external
 * host clients are using. Prefer the forwarded headers the proxy injects,
 * falling back to the raw `host` and `request.url` for local/dev usage.
 */
function publicOrigin(request: Request): string {
	const url = new URL(request.url);
	const host =
		request.headers.get("x-forwarded-host") ??
		request.headers.get("host") ??
		url.host;
	const proto =
		request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
	return `${proto}://${host}`;
}

export async function GET(request: Request) {
	const env = serverEnv();
	const origin = publicOrigin(request);
	// DECLARED_ONCE_SHOWN_EVERYWHERE: rendered from the grant declarations on every read, never a copy table.
	const { permissions } = buildPermissionCatalog(
		buildRequiresById([...CORE_TOOL_BUNDLE]),
	);
	return NextResponse.json({
		name: "Cogni Node API",
		version: "v1",
		buildSha: env.APP_BUILD_SHA,
		// IDENTITY_IS_REPO_SPEC_PROJECTION: the node's display identity, projected from its own repo-spec
		// `intent` (never hardcoded). The operator reads THIS to render gallery cards — no operator-side
		// per-node literals. A node customizes itself by editing repo-spec, not operator code.
		identity: {
			name: getNodeName(),
			hook: getNodeHook(),
			mission: getNodeMission(),
			brand: {
				icon: getNodeBrandIcon(),
				color: getNodeBrandColor(),
				thumbnail: getNodeThumbnail(),
			},
		},
		registrationUrl: `${origin}/api/v1/agent/register`,
		auth: {
			type: "bearer",
			keyPrefix: "cogni_ag_sk_v1_",
			// The revocable key an agent upgrades to (POST /api/v1/agent/credentials/upgrade).
			revocableKeyPrefix: REVOCABLE_KEY_PREFIX,
		},
		endpoints: {
			openapi: `${origin}/openapi.json`,
			completions: `${origin}/api/v1/chat/completions`,
			graphs: `${origin}/api/v1/ai/agents`,
			runs: `${origin}/api/v1/agent/runs`,
			runStream: `${origin}/api/v1/agent/runs/{runId}/stream`,
			// Cognition substrate: session-start bundle (invariants + live skills
			// index + domain pointers). A SessionStart hook fetches + injects it.
			cognition: `${origin}/api/v1/cognition`,
			workItems: `${origin}/api/v1/work/items`,
			workItemClaims: `${origin}/api/v1/work/items/{id}/claims`,
			workItemHeartbeat: `${origin}/api/v1/work/items/{id}/heartbeat`,
			workItemCoordination: `${origin}/api/v1/work/items/{id}/coordination`,
		},
		// Scopes an outside agent can ask for (requestPermission). Derived from the declarations, not listed here.
		permissions,
		permissionsHow:
			"Ask with requestPermission; a node admin turns it On in the Admin area (/admin/ai-access).",
		actions: {
			register: {
				method: "POST",
				endpoint: `${origin}/api/v1/agent/register`,
				auth: { type: "none" },
				inputSchema: toJsonSchema(registerAgentOperation.input),
				outputSchema: toJsonSchema(registerAgentOperation.output),
			},
			upgradeCredential: {
				method: "POST",
				endpoint: `${origin}/api/v1/agent/credentials/upgrade`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(z.strictObject({})),
				outputSchema: toJsonSchema(upgradeAgentCredentialOperation.output),
			},
			confirmCredential: {
				method: "POST",
				endpoint: `${origin}/api/v1/agent/credentials/confirm`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(z.strictObject({})),
				outputSchema: toJsonSchema(confirmAgentCredentialOperation.output),
			},
			rotateCredential: {
				method: "POST",
				endpoint: `${origin}/api/v1/agent/credentials/rotate`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(z.strictObject({})),
				outputSchema: toJsonSchema(rotateAgentCredentialOperation.output),
			},
			revokeCredential: {
				method: "POST",
				endpoint: `${origin}/api/v1/agent/credentials/revoke`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(revokeAgentCredentialOperation.input),
				outputSchema: toJsonSchema(revokeAgentCredentialOperation.output),
			},
			requestPermission: {
				method: "POST",
				endpoint: `${origin}/api/v1/agent/access-requests`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(agentAccessRequestCreateOperation.input),
				outputSchema: toJsonSchema(agentAccessRequestCreateOperation.output),
			},
			listMyPermissions: {
				method: "GET",
				endpoint: `${origin}/api/v1/agent/access-requests`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(z.strictObject({})),
				outputSchema: toJsonSchema(agentAccessRequestListOperation.output),
			},
			listWorkItems: {
				method: "GET",
				endpoint: `${origin}/api/v1/work/items`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsListOperation.input),
				outputSchema: toJsonSchema(workItemsListOperation.output),
			},
			createWorkItem: {
				method: "POST",
				endpoint: `${origin}/api/v1/work/items`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsCreateOperation.input),
				outputSchema: toJsonSchema(workItemsCreateOperation.output),
			},
			getWorkItem: {
				method: "GET",
				endpoint: `${origin}/api/v1/work/items/{id}`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsGetOperation.input),
				outputSchema: toJsonSchema(workItemsGetOperation.output),
			},
			updateWorkItem: {
				method: "PATCH",
				endpoint: `${origin}/api/v1/work/items/{id}`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsPatchOperation.input),
				outputSchema: toJsonSchema(workItemsPatchOperation.output),
			},
			deleteWorkItem: {
				method: "DELETE",
				endpoint: `${origin}/api/v1/work/items/{id}`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsDeleteOperation.input),
				outputSchema: toJsonSchema(workItemsDeleteOperation.output),
			},
			claimWorkItem: {
				method: "POST",
				endpoint: `${origin}/api/v1/work/items/{id}/claims`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsClaimOperation.input),
				outputSchema: toJsonSchema(workItemsClaimOperation.output),
			},
			heartbeatWorkItem: {
				method: "POST",
				endpoint: `${origin}/api/v1/work/items/{id}/heartbeat`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsHeartbeatOperation.input),
				outputSchema: toJsonSchema(workItemsHeartbeatOperation.output),
			},
			releaseWorkItem: {
				method: "DELETE",
				endpoint: `${origin}/api/v1/work/items/{id}/claims?runId={runId}`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsReleaseOperation.input),
				outputSchema: toJsonSchema(workItemsReleaseOperation.output),
			},
			getWorkItemHistory: {
				method: "GET",
				endpoint: `${origin}/api/v1/work/items/{id}/history`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsHistoryOperation.input),
				outputSchema: toJsonSchema(workItemsHistoryOperation.output),
			},
			getKnowledgeHistory: {
				method: "GET",
				endpoint: `${origin}/api/v1/knowledge/{id}/history`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(knowledgeHistoryOperation.input),
				outputSchema: toJsonSchema(knowledgeHistoryOperation.output),
			},
			getWorkItemCoordination: {
				method: "GET",
				endpoint: `${origin}/api/v1/work/items/{id}/coordination`,
				auth: { type: "bearer" },
				inputSchema: toJsonSchema(workItemsCoordinationOperation.input),
				outputSchema: toJsonSchema(workItemsCoordinationOperation.output),
			},
		},
		cognition: {
			bootstrapUrl: `${origin}/api/v1/cognition`,
			sessionStartHook: `curl -fsS ${origin}/api/v1/cognition | jq -r .markdown`,
		},
		defaults: {
			model: "gpt-4o-mini",
			graph_name: "poet",
		},
		usage: {
			note: "completions requires graph_name for newly registered agents",
			example: {
				model: "gpt-4o-mini",
				graph_name: "poet",
				messages: [{ role: "user", content: "Hello" }],
			},
		},
	});
}
