import { Circuit } from "tscircuit"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import Board from "./board"

// Capture the built-in bus_lanes phase immediately before core constructs its
// autorouter. No algorithmFn, layer normalization, or solver dependency override.
const scope = process.argv[2] ?? "full"
if (!["full", "byte0", "pair"].includes(scope))
  throw Error("Unknown capture scope")
const directory = `${import.meta.dir}/../results/capture-${scope}`
mkdirSync(directory, { recursive: true })
const circuit = new Circuit()
const stop = new Error(
  "MT8395 input captured; intentionally stopped before routing",
)
let captures = 0
circuit.on("autorouting:start", (event) => {
  captures++
  const input = event.simpleRouteJson
  writeFileSync(`${directory}/input.srj.json`, JSON.stringify(input, null, 2))
  writeFileSync(
    `${directory}/metadata.json`,
    JSON.stringify(
      {
        scope,
        inputSha256: createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex"),
        signals: circuit.db.source_trace
          .list()
          .map(({ source_trace_id, name, display_name }) => ({
            sourceTraceId: source_trace_id,
            name,
            endpoints: display_name,
          })),
      },
      null,
      2,
    ),
  )
  throw stop
})
circuit.add(<Board scope={scope} />)
try {
  await circuit.renderUntilSettled()
} catch (error) {
  if (error !== stop) throw error
}
if (captures !== 1)
  throw Error(`Expected one native routing input, received ${captures}`)
console.log(
  `Captured ${scope} before the built-in bus_lanes solver: ${directory}/input.srj.json`,
)
