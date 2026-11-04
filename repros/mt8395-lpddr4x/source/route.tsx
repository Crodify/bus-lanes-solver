import { plugin } from "bun"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import Board from "./board"
import { inputHash, loadCase } from "../input"
import { validateOutput } from "../validate"
import { runs } from "./reviewed-solver"
import { auditBoardExport } from "../audit-board-export"

const scope = process.argv[2] ?? "full"
if (scope !== "full" && scope !== "byte0" && scope !== "pair")
  throw Error("Expected full, byte0 or pair")
const directory = fileURLToPath(
  new URL(`../results/core-routed-${scope}/`, import.meta.url),
)
mkdirSync(directory, { recursive: true })
for (const name of [
  "report.json",
  "input.srj.json",
  "circuit.json",
  "accepted.srj.json",
  ...["", "-top", "-inner2", "-inner4", "-inner6"].flatMap((layer) => [
    `board${layer}.svg`,
    `board${layer}.png`,
  ]),
])
  rmSync(`${directory}/${name}`, { force: true })
const solverRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: fileURLToPath(new URL("../../../", import.meta.url)),
  encoding: "utf8",
}).trim()
const save = (name: string, value: unknown) =>
  writeFileSync(`${directory}/${name}`, JSON.stringify(value, null, 2))
const corePath = fileURLToPath(import.meta.resolve("@tscircuit/core"))
const coreBundle = readFileSync(corePath, "utf8")
const coreVersion = JSON.parse(
  readFileSync(
    new URL("../package.json", import.meta.resolve("@tscircuit/core")),
    "utf8",
  ),
).version
// The pinned published core embeds bus-lanes-solver. Replace only that bundled
// dependency binding in memory. The native adapter, SRJ generation, completion
// handling, circuit checks and PCB export remain the published core code.
const marker = "this.solver = new BusLanesPipelineSolver(input);"
if (coreBundle.split(marker).length !== 2)
  throw Error("Pinned core adapter changed; review dependency injection")
let loads = 0
plugin({
  name: "reviewed-bus-lanes-dependency",
  setup(build) {
    build.onLoad(
      { filter: /@tscircuit\/core\/dist\/index\.js$/ },
      ({ path }) => {
        if (path !== corePath) return
        loads++
        return {
          loader: "js",
          contents: `import { ReviewedSolver as __ReviewedSolver } from ${JSON.stringify(fileURLToPath(new URL("./reviewed-solver.ts", import.meta.url)))};\n${coreBundle}\nBusLanesPipelineSolver = __ReviewedSolver;\n`,
        }
      },
    )
  },
})
const { Circuit } = await import("@tscircuit/core")
const { metadata } = loadCase(scope)
const circuit = new Circuit()
const errors: string[] = []
let captured: any = null
circuit.on("autorouting:start", (event: any) => {
  if (captured) throw Error("Expected one routing request")
  if (inputHash(event.simpleRouteJson) !== metadata.inputSha256)
    throw Error("Core request differs from the immutable capture")
  captured = structuredClone(event.simpleRouteJson)
  save("input.srj.json", captured)
})
circuit.on("asyncEffect:end", (event: any) => {
  if (event.error) errors.push(String(event.error))
})
const started = performance.now()
circuit.add(<Board scope={scope} />)
try {
  await circuit.renderUntilSettled()
} catch (error) {
  errors.push(String(error))
}
const renderMilliseconds = performance.now() - started
console.log(
  JSON.stringify({ stage: "core-render-completed", renderMilliseconds }),
)
const json = circuit.getCircuitJson()
const solver = runs[0]
const output = solver?.solved && !solver.failed ? solver.getOutput() : null
const validation = output && captured ? validateOutput(captured, output) : null
const exportAudit =
  output && captured ? auditBoardExport(captured, output, json) : null
const sourceTraces = json.filter((e: any) => e.type === "source_trace")
const pcbTraces = json.filter((e: any) => e.type === "pcb_trace")
const vias = json.filter((e: any) => e.type === "pcb_via")
const circuitErrors = json.filter((e: any) => e.type.endsWith("_error"))
const missing = sourceTraces
  .filter(
    (s: any) =>
      !pcbTraces.some((p: any) => p.source_trace_id === s.source_trace_id),
  )
  .map((s: any) => s.source_trace_id)
const accepted =
  loads === 1 &&
  runs.length === 1 &&
  !!validation?.accepted &&
  !!exportAudit?.accepted &&
  !errors.length &&
  !circuitErrors.length &&
  !missing.length &&
  pcbTraces.length === sourceTraces.length &&
  inputHash(solver.input) === metadata.inputSha256
const report = {
  scope,
  accepted,
  solverRevision,
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
  coreVersion,
  coreBundleSha256: createHash("sha256").update(coreBundle).digest("hex"),
  dependencyLoads: loads,
  solverRuns: runs.length,
  inputSha256: captured && inputHash(captured),
  inputUnchanged: !!solver && inputHash(solver.input) === metadata.inputSha256,
  outputSha256: output && inputHash(output),
  circuitSha256: createHash("sha256")
    .update(JSON.stringify(json))
    .digest("hex"),
  renderMilliseconds,
  solved: solver?.solved,
  failed: solver?.failed,
  error: solver?.error,
  phase: solver?.phase,
  iterations: solver?.iterations,
  requestedSignals: sourceTraces.length,
  routedSignals: pcbTraces.length,
  vias: vias.length,
  missingSourceTraceIds: missing,
  errors,
  circuitErrors,
  validation,
  exportAudit,
}
save("report.json", report)
if (accepted) {
  save("circuit.json", json)
  save("accepted.srj.json", output)
}
console.log(JSON.stringify({ ...report, validation: undefined }, null, 2))
if (!accepted) process.exitCode = 1
