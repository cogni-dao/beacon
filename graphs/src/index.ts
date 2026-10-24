import {
  LANGGRAPH_CATALOG as LOCAL_CATALOG,
  LANGGRAPH_GRAPH_IDS as LOCAL_IDS,
} from "@cogni/langgraph-graphs";
import { LANGGRAPH_CATALOG as SHARED_CATALOG } from "@cogni/shared-langgraph-graphs";

export * from "@cogni/langgraph-graphs/graphs";

const prioritizer = SHARED_CATALOG["work-prioritizer"];
if (!prioritizer)
  throw new Error("Shared evaluation package lacks work-prioritizer");
export const LANGGRAPH_CATALOG: typeof LOCAL_CATALOG = {
  ...LOCAL_CATALOG,
  "work-prioritizer": prioritizer,
};
export const LANGGRAPH_GRAPH_IDS = {
  ...LOCAL_IDS,
  "work-prioritizer": "langgraph:work-prioritizer" as const,
};
