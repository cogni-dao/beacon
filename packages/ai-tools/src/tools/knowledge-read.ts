// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Published domain tool; retain the node's legacy module path. */
export {
  createKnowledgeReadImplementation,
  KNOWLEDGE_READ_NAME,
  type KnowledgeReadDeps,
  type KnowledgeReadInput,
  KnowledgeReadInputSchema,
  type KnowledgeReadOutput,
  KnowledgeReadOutputSchema,
  type KnowledgeReadRedacted,
  knowledgeReadBoundTool,
  knowledgeReadContract,
  knowledgeReadStubImplementation,
} from "@cogni/shared-ai-tools";

import { KnowledgeReadOutputSchema } from "@cogni/shared-ai-tools";
export const KnowledgeReadEntrySchema =
  KnowledgeReadOutputSchema.shape.entries.element;
