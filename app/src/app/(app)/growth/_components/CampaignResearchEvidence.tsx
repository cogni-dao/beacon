// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignResearchEvidence`
 * Purpose: Render the compact operator-facing summary of persisted campaign
 *   research findings before generated drafts.
 * Scope: Pure presentation. Receives facade data; no fetching or mutation.
 * Invariants:
 *   - SYNTHESIS_NOT_REPORTS: humans see short takeaways + the next action, not
 *     the full research artifact list. Detailed findings remain persisted for
 *     graph reuse and cache grounding.
 *   - RESEARCH_BEFORE_DRAFTS: this panel is intended to render above the funnel.
 * Side-effects: none
 * Links: ../[campaignId]/view.tsx, app/src/app/_facades/growth/campaigns.server.ts
 * @internal
 */

import { ArrowRight, ExternalLink, Lightbulb, Link2 } from "lucide-react";
import type { ReactElement } from "react";

import { Card, CardContent } from "@/components";
import type { CampaignFinding } from "@/app/_facades/growth/campaigns.server";

const SOURCE_BACKED_KINDS = new Set(["exemplar", "reference"]);
const TAKEAWAY_KIND_PRIORITY = ["angle", "insight", "pain_point"] as const;
const TAKEAWAY_LIMIT = 2;
const TAKEAWAY_MAX_CHARS = 180;
const SOURCE_CONTENT_MAX_CHARS = 140;

function stringMeta(
  metadata: CampaignFinding["metadata"],
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function stringArrayMeta(
  metadata: CampaignFinding["metadata"],
  key: string
): string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "pain_point":
      return "Pain point";
    case "insight":
      return "Insight";
    case "angle":
      return "Angle";
    case "exemplar":
      return "Exemplar";
    case "reference":
      return "Reference";
    default:
      return kind.replaceAll("_", " ");
  }
}

function isSourceBacked(finding: CampaignFinding): boolean {
  return Boolean(finding.sourceRef) || SOURCE_BACKED_KINDS.has(finding.kind);
}

function compact(value: string, max = TAKEAWAY_MAX_CHARS): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function sourceHref(finding: CampaignFinding): string | null {
  if (!finding.sourceRef) return null;
  if (finding.sourceRef.startsWith("post:")) {
    return `#post-${finding.sourceRef.slice("post:".length)}`;
  }
  if (finding.sourceRef.startsWith("connection:")) {
    return "/profile";
  }
  if (finding.sourceRef.startsWith("playbook:")) {
    return "/knowledge";
  }
  if (finding.sourceRef.startsWith("http://") || finding.sourceRef.startsWith("https://")) {
    return finding.sourceRef;
  }
  return null;
}

function sourceLabel(finding: CampaignFinding): string {
  const metadata = finding.metadata;
  const sourceType = stringMeta(metadata, "sourceType");
  const platform = stringMeta(metadata, "platform");
  const sourceAccount = stringMeta(metadata, "sourceAccountRef");
  const sourcePost = stringMeta(metadata, "sourcePostRef");

  if (sourcePost) {
    return [platform, "post", sourcePost].filter(Boolean).join(" ");
  }
  if (sourceAccount) {
    return [platform, "account", sourceAccount].filter(Boolean).join(" ");
  }
  if (sourceType) {
    return sourceType.replaceAll("_", " ");
  }
  return finding.sourceRef ?? kindLabel(finding.kind);
}

function metadataNextAction(findings: CampaignFinding[]): string | null {
  for (const finding of findings) {
    const action =
      stringMeta(finding.metadata, "nextAction") ??
      stringMeta(finding.metadata, "recommendedNextAction");
    if (action) return action;
  }
  return null;
}

function selectTakeaways(findings: CampaignFinding[]): CampaignFinding[] {
  const selected: CampaignFinding[] = [];
  const seen = new Set<string>();

  for (const kind of TAKEAWAY_KIND_PRIORITY) {
    const finding = findings.find(
      (candidate) => candidate.kind === kind && !seen.has(candidate.id)
    );
    if (finding) {
      selected.push(finding);
      seen.add(finding.id);
    }
    if (selected.length >= TAKEAWAY_LIMIT) return selected;
  }

  for (const finding of findings) {
    if (!isSourceBacked(finding) && !seen.has(finding.id)) {
      selected.push(finding);
      seen.add(finding.id);
    }
    if (selected.length >= TAKEAWAY_LIMIT) return selected;
  }

  return selected.length > 0 ? selected : findings.slice(0, TAKEAWAY_LIMIT);
}

function nextAction(findings: CampaignFinding[]): string {
  const aiSuggested = metadataNextAction(findings);
  if (aiSuggested) return aiSuggested;
  if (findings.some((finding) => finding.kind === "angle")) {
    return "Generate or refine drafts around the strongest angle, then approve only the ones that match the campaign voice.";
  }
  if (findings.some((finding) => finding.kind === "pain_point")) {
    return "Generate drafts that name the pain clearly before pitching Beacon.";
  }
  if (findings.some(isSourceBacked)) {
    return "Use the evidence-backed pattern as grounding for the next generation pass.";
  }
  return "Run research before generating more drafts.";
}

export function CampaignResearchEvidence({
  findings,
}: {
  findings: CampaignFinding[];
}): ReactElement {
  const sourceBacked = findings.filter(isSourceBacked);
  const takeaways = selectTakeaways(findings);
  const actionFromResearch = metadataNextAction(findings);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Research
          </h2>
          {findings.length > 0 && sourceBacked.length === 0 && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <Link2 className="size-3.5" aria-hidden="true" />
              0 source-backed
            </span>
          )}
        </div>

        {findings.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border border-dashed p-3">
            <p className="text-muted-foreground text-sm">
              No research takeaways yet.
            </p>
            <p className="inline-flex items-center gap-1.5 font-medium text-xs">
              <ArrowRight className="size-3.5" aria-hidden="true" />
              Run Research
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {sourceBacked.length > 0 && (
              <details className="group rounded-md border border-border/70 p-3 text-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-muted-foreground text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <Link2 className="size-3.5" aria-hidden="true" />
                    {sourceBacked.length} source-backed
                  </span>
                  <span className="text-foreground group-open:hidden">
                    View sources
                  </span>
                  <span className="hidden text-foreground group-open:inline">
                    Hide sources
                  </span>
                </summary>
                <ul className="mt-3 grid gap-2">
                  {sourceBacked.map((finding) => {
                    const href = sourceHref(finding);
                    const evidenceBasis = stringArrayMeta(
                      finding.metadata,
                      "evidenceBasis"
                    );
                    return (
                      <li
                        key={finding.id}
                        className="grid gap-1 rounded-md bg-muted/60 p-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {href ? (
                            <a
                              href={href}
                              className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                            >
                              {sourceLabel(finding)}
                              <ExternalLink
                                className="size-3"
                                aria-hidden="true"
                              />
                            </a>
                          ) : (
                            <span className="font-medium">
                              {sourceLabel(finding)}
                            </span>
                          )}
                          <span className="text-muted-foreground text-xs">
                            {kindLabel(finding.kind)}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {compact(finding.content, SOURCE_CONTENT_MAX_CHARS)}
                        </p>
                        {evidenceBasis.length > 0 && (
                          <p className="text-muted-foreground text-xs">
                            Basis: {evidenceBasis.join(", ")}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
            <ul className="grid gap-2">
              {takeaways.map((finding) => (
                <li
                  key={finding.id}
                  className="flex gap-2 text-sm leading-relaxed"
                >
                  <Lightbulb
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium">
                      {kindLabel(finding.kind)}:
                    </span>{" "}
                    {compact(finding.content)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="inline-flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
              <ArrowRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span>
                <span className="font-medium">
                  {actionFromResearch ? "Recommended next:" : "Suggested next:"}
                </span>{" "}
                {nextAction(findings)}
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
