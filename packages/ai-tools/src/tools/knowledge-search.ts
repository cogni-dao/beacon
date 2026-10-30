// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Published domain tool; retain the node's legacy module path. */
export {
  createKnowledgeSearchImplementation,
  KNOWLEDGE_SEARCH_NAME,
  type KnowledgeSearchDeps,
  type KnowledgeSearchInput,
  KnowledgeSearchInputSchema,
  type KnowledgeSearchOutput,
  KnowledgeSearchOutputSchema,
  type KnowledgeSearchRedacted,
  knowledgeSearchBoundTool,
  knowledgeSearchContract,
  knowledgeSearchStubImplementation,
} from "@cogni/shared-ai-tools";

import { KnowledgeSearchOutputSchema } from "@cogni/shared-ai-tools";
export const KnowledgeSearchResultSchema =
  KnowledgeSearchOutputSchema.shape.results.element;
