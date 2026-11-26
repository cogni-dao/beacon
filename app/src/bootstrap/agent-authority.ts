// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Node-owned dependency composition for the released authority. No grants are created here. */
import { createAgentToolAuthority } from "@cogni/agent-grants/host";
import { LANGGRAPH_CATALOG } from "@cogni/node-template-graphs";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { getContainer } from "./container";
import { BEACON_CORE_TOOL_BUNDLE } from "./ai/evaluation-baseline";

export function resolveAgentAuthority() {
  const container = getContainer();
  return createAgentToolAuthority({
    sql: getServiceDb().$client,
    nodeAdmin: container.nodeAdmin,
    log: container.log,
    tools: BEACON_CORE_TOOL_BUNDLE.map(({ contract }) => ({
      id: contract.name,
      ...("requires" in contract ? { requires: contract.requires } : {}),
    })),
    graphs: Object.values(LANGGRAPH_CATALOG),
    systemUserIds: [],
  });
}
