import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { SAMPLE_NAMES } from "./pr-benchmark/report"
const base = JSON.parse(readFileSync("literal/base.json", "utf8"))
const head = JSON.parse(readFileSync("literal/head.json", "utf8"))
mkdirSync("reports", { recursive: true })
for (const sample of SAMPLE_NAMES) {
  const workers = [base, head].map(reports => {
    const report = reports.find((r: {sample: string}) => r.sample === sample)
    if (!report) return { report: null, wallMilliseconds: 0, exitCode: null, error: "Missing sample", missing: true }
    return { report, wallMilliseconds: report.milliseconds, exitCode: report.status === "validation_failed" ? 1 : 0,
      error: report.error, timedOut: report.status === "timed_out" }
  })
  writeFileSync("reports/" + sample + ".json", JSON.stringify({
    sample, timeoutSeconds: 3600, main: workers[0], pr: workers[1],
    metadata: {
      order: ["main", "pr"], mainSha: process.env.BASE_SHA, prSha: process.env.HEAD_SHA,
      controllerSha: process.env.BASE_SHA, bunVersion: Bun.version,
      platform: process.platform, architecture: process.arch,
      runnerName: process.env.RUNNER_NAME, runnerOS: process.env.RUNNER_OS,
    }
  }))
}
