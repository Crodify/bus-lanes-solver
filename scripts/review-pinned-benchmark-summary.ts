import { readFile, writeFile } from "node:fs/promises"
import { loadSamplePairs, renderComparison, summarizeComparison } from "../scripts/pr-benchmark/report"

const samples = await loadSamplePairs("reports")
const options = {
  samples,
  mainSha: process.env.BASE_SHA!,
  prSha: process.env.HEAD_SHA!,
  controllerSha: process.env.BASE_SHA!,
  prNumber: Number(process.env.PR_NUMBER),
  timeoutSeconds: 3600,
  runUrl: process.env.SOURCE_RUN_URL!,
}
const summary = summarizeComparison(options)
const lines = [renderComparison(options), "", "Independent native audit details", "",
  "| Sample | Revision | Solved / connected | Native DRC issues | Immutable power fanouts | Input unchanged |",
  "| --- | --- | --- | --- | --- | --- |"]
const number = (measurement: number | null | undefined) =>
  measurement === null || measurement === undefined ? "n/a" : measurement.toFixed(6)
for (const pair of samples)
  for (const revision of ["main", "pr"] as const) {
    const report = pair[revision].report as {
      solved?: boolean; routedSignals?: number; requestedSignals?: number;
      fixedPowerPreserved?: boolean; inputUnchanged?: boolean; solveMilliseconds?: number;
      validation?: {
        complete?: boolean; fixedPowerTraces?: number; fixedPowerVias?: number;
        fixedPowerPadJoins?: number; fixedDrc?: { valid: boolean; issues: unknown[] };
        combinedDrc?: { valid: boolean; issues: unknown[] };
        quality?: { pairGaps?: Array<{
          connectionNames: string[]; matched: boolean; minEdgeGapMm: number;
          maxEdgeGapMm: number; maxAllowedEdgeGapMm: number; maxSamplingErrorMm: number;
        }>; exteriorPairGaps?: Array<{
          connectionNames: string[]; applicable: boolean; matched: boolean;
          maxExteriorEdgeGapMm: number; separatedExteriorLengthMm: number;
        }> }
      }
    } | null
    const audit = report?.validation
    lines.push("| " + [pair.sample, revision === "main" ? "base" : "head",
      (report?.solved ? "yes" : "no") + " / " + (audit?.complete ? report?.routedSignals : "incomplete") + "/" + report?.requestedSignals,
      audit?.combinedDrc?.issues.length ?? "missing",
      report?.fixedPowerPreserved ? audit?.fixedPowerTraces + " traces / " + audit?.fixedPowerVias + " vias / " + audit?.fixedPowerPadJoins + " native pad joins" : "FAILED",
      report?.inputUnchanged ? "yes" : "FAILED"].join(" | ") + " |")
  }
lines.push("", "Shared and exterior differential-pair coupling (mm)", "",
  "| Sample | Revision | Pair | Shared edge gap min–max | Shared max + sampling error / bound | Exterior max gap | Separated exterior length | Accepted |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |")
for (const pair of samples)
  for (const revision of ["main", "pr"] as const) {
    const quality = (pair[revision].report as {
      validation?: { quality?: {
        pairGaps?: Array<{connectionNames: string[]; matched: boolean; minEdgeGapMm: number; maxEdgeGapMm: number; maxSamplingErrorMm: number; maxAllowedEdgeGapMm: number}>;
        exteriorPairGaps?: Array<{connectionNames: string[]; applicable: boolean; matched: boolean; maxExteriorEdgeGapMm: number; separatedExteriorLengthMm: number}>;
      }}
    } | null)?.validation?.quality
    for (const shared of quality?.pairGaps ?? []) {
      const exterior = quality?.exteriorPairGaps?.find(p => JSON.stringify(p.connectionNames) === JSON.stringify(shared.connectionNames))
      lines.push("| " + [pair.sample, revision === "main" ? "base" : "head",
        shared.connectionNames.join("/"),
        number(shared.minEdgeGapMm) + "–" + number(shared.maxEdgeGapMm),
        number(shared.maxEdgeGapMm + shared.maxSamplingErrorMm) + " / " + number(shared.maxAllowedEdgeGapMm),
        exterior?.applicable ? number(exterior.maxExteriorEdgeGapMm) : "not applicable",
        exterior?.applicable ? number(exterior.separatedExteriorLengthMm) : "not applicable",
        shared.matched && (!exterior?.applicable || exterior.matched) ? "yes" : "FAILED"].join(" | ") + " |")
    }
  }
lines.push("", "Every duration above is a fresh solve. Raw reports and worker logs remain in the linked source workflow artifacts; this document contains the requested comparison and audit measurements only.", "")
await writeFile("reviewed-comparison.md", lines.join("\n"))
console.log(JSON.stringify({main: summary.main, pr: summary.pr, matched: summary.matched,
  comparable: summary.artifactComplete && summary.inputComparable && summary.metadataComparable}))
