import {
  LANGGRAPH_CATALOG as LOCAL_CATALOG,
  LANGGRAPH_GRAPH_IDS as LOCAL_IDS,
} from "@cogni/langgraph-graphs";
import { LANGGRAPH_CATALOG as SHARED_CATALOG } from "@cogni/shared-langgraph-graphs";

export * from "@cogni/langgraph-graphs/graphs";

const prioritizer = SHARED_CATALOG["work-prioritizer"];
if (!prioritizer)
  throw new Error("Shared evaluation package lacks work-prioritizer");
type NodeCatalogEntry = (typeof LOCAL_CATALOG)[string] & {
  readonly principal?: string;
};
function actsAsNodeAi(name: string): NodeCatalogEntry {
  const entry = LOCAL_CATALOG[name];
  if (!entry) throw new Error(`Missing Beacon graph: ${name}`);
  return { ...entry, principal: "node-ai" };
}
export const LANGGRAPH_CATALOG: Readonly<Record<string, NodeCatalogEntry>> = {
  ...LOCAL_CATALOG,
  brain: actsAsNodeAi("brain"),
  content: actsAsNodeAi("content"),
  "autoresearch-single-lane": actsAsNodeAi("autoresearch-single-lane"),
  "autoresearch-syntropy-loop": actsAsNodeAi("autoresearch-syntropy-loop"),
  "autoresearch-registry-swarm": actsAsNodeAi("autoresearch-registry-swarm"),
  "operating-review": actsAsNodeAi("operating-review"),
  "work-prioritizer": prioritizer,
};
export const LANGGRAPH_GRAPH_IDS = {
  ...LOCAL_IDS,
  "work-prioritizer": "langgraph:work-prioritizer" as const,
};
