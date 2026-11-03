import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import type { BusLanesPipelineSolver } from "../../lib/bus-lanes-pipeline-solver"
import { caseNames, inputHash, loadCase, type CaseName } from "./input"
import { validateOutput } from "./validate"

const args = process.argv.slice(2)
const name = (args[0] ?? "full") as CaseName
if (!caseNames.includes(name)) throw Error("Case must be full, byte0, or pair")
const option = (key: string) => {
  const index = args.indexOf(key)
  if (index === -1) return undefined
  if (!args[index + 1] || args[index + 1].startsWith("--"))
    throw Error(`Missing ${key} value`)
  return args[index + 1]
}
for (let i = 1; i < args.length; i += 2)
  if (!["--timeout-ms", "--solver", "--label"].includes(args[i]))
    throw Error(`Unknown option ${args[i]}`)
const budget = Number(option("--timeout-ms") ?? 60000)
if (!Number.isFinite(budget) || budget <= 0)
  throw Error("Timeout must be positive")
const label = option("--label") ?? name
if (!/^[a-zA-Z0-9_-]+$/.test(label))
  throw Error("Label must be a directory name")
const directory = `${import.meta.dir}/results/${label}`
mkdirSync(directory, { recursive: true })
for (const file of ["report.json", "output.srj.json", "accepted.srj.json"])
  rmSync(`${directory}/${file}`, { force: true })
const solverPath = resolve(
  option("--solver") ?? `${import.meta.dir}/../../lib/index.ts`,
)
const { BusLanesPipelineSolver: Solver } = await import(solverPath)
const { input, metadata } = loadCase(name)
// Deliberately pass the exact input object to the checkout's solver. Do not add
// allowedLayers, normalize ownership, rename connections, or remove unused pads.
const started = performance.now()
const solver: BusLanesPipelineSolver = new Solver(input, {
  maxRoutingTimeMs: budget,
})
solver.solve()
const milliseconds = performance.now() - started
const unchanged = inputHash(input) === metadata.inputSha256
const output = solver.solved && !solver.failed ? solver.getOutput() : null
const validation = output ? validateOutput(input, output) : null
const report = {
  case: name,
  solverPath,
  inputSha256: metadata.inputSha256,
  outputSha256: output ? inputHash(output) : null,
  inputUnchanged: unchanged,
  timeoutMs: budget,
  solveMilliseconds: milliseconds,
  requestedSignals: input.connections.length,
  obstacles: input.obstacles.length,
  solved: solver.solved,
  failed: solver.failed,
  phase: solver.phase,
  failureCode: solver.failureCode,
  error: solver.error,
  iterations: solver.iterations,
  accepted: unchanged && !!validation?.accepted,
  acceptedSignals:
    unchanged && validation?.accepted ? output!.traces!.length : 0,
  stats: solver.stats,
  validation,
}
writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2))
if (output)
  writeFileSync(`${directory}/output.srj.json`, JSON.stringify(output, null, 2))
if (report.accepted)
  writeFileSync(
    `${directory}/accepted.srj.json`,
    JSON.stringify(output, null, 2),
  )
console.log(
  JSON.stringify(
    { ...report, stats: undefined, validation: undefined },
    null,
    2,
  ),
)
if (!report.accepted) process.exitCode = 1
