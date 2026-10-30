// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/knowledge.domains.v1.contract`
 * Purpose: HTTP contract for the knowledge domain registry — GET list with entry counts and POST register.
 * Scope: Zod schemas for the wire format. Does not contain business logic, I/O, or auth policy.
 * Invariants:
 *   - DOMAIN_HTTP_REQUIRES_PRINCIPAL (route enforces, contract does not): GET list
 *     accepts any authenticated principal — session human or bearer agent
 *     (DOMAIN_LIST_REQUIRES_PRINCIPAL); POST register accepts bearer or session
 *     (DOMAIN_REGISTER_BEARER_OR_SESSION).
 *   - DOMAIN_DELETE_REFUSES_NONEMPTY; baseline domains remain protected.
 *   - id is short, slug-shaped (alnum, dash, underscore).
 * Side-effects: none
 * Links: docs/spec/knowledge-domain-registry.md
 * @internal
 */

import { z } from "zod";

export const DomainIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, {
    message: "domain id must start with [a-z0-9] and contain only [a-z0-9_-]",
  });

export const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  confidencePct: z.number().int(),
  entryCount: z.number().int(),
  createdAt: z.string(),
});
export type DomainRow = z.infer<typeof DomainSchema>;

export const DomainsListResponseSchema = z.object({
  domains: z.array(DomainSchema),
});
export type DomainsListResponse = z.infer<typeof DomainsListResponseSchema>;

export const DomainsCreateRequestSchema = z.object({
  id: DomainIdSchema,
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
});
export type DomainsCreateRequest = z.infer<typeof DomainsCreateRequestSchema>;

export const DomainsCreateResponseSchema = DomainSchema;
export type DomainsCreateResponse = z.infer<typeof DomainsCreateResponseSchema>;

export const DomainsUpdateBodySchema = z
  .strictObject({
    name: z.string().min(1).max(128).optional(),
    description: z.string().max(512).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: "patch must set name or description",
  });
export type DomainsUpdateBody = z.infer<typeof DomainsUpdateBodySchema>;

export const DomainsDeleteResponseSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
});
export const DomainsErrorResponseSchema = z.object({
  error: z.string(),
  errorCode: z.enum([
    "unauthorized",
    "invalid_json",
    "invalid_input",
    "domain_not_found",
    "domain_not_empty",
    "domain_protected",
    "store_not_configured",
    "knowledge_write_outcome_unknown",
    "knowledge_write_scope_required",
    "knowledge_write_conflict",
    "knowledge_busy",
  ]),
  retryable: z.boolean().optional(),
  entryCount: z.number().int().optional(),
  issues: z.array(z.unknown()).optional(),
  operationId: z.string().optional(),
  branch: z.string().optional(),
  commitHash: z.string().nullable().optional(),
  entryId: z.string().optional(),
});
export type DomainsErrorResponse = z.infer<typeof DomainsErrorResponseSchema>;
