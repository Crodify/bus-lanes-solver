import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { RootCircuit } from "tscircuit"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { NativeDdrBoard } from "../preloaded-ddr/circuits/native-ddr-board"

const source: Parameters<typeof NativeDdrBoard>[0]["source"] = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("../preloaded-ddr/circuits/a64.json.gz", import.meta.url),
    ),
  ).toString("utf8"),
)
const directory = process.argv[2] ?? "results"
mkdirSync(directory, { recursive: true })
const circuit = new RootCircuit()
let phaseEventCount = 0
circuit.on("autorouting:start", (event) => {
  phaseEventCount++
  writeFileSync(
    `${directory}/phase-${phaseEventCount}-input.srj.json`,
    JSON.stringify(event.simpleRouteJson),
  )
})
circuit.on("autorouting:end", (event) => {
  phaseEventCount++
  writeFileSync(
    `${directory}/phase-${phaseEventCount}-output.srj.json`,
    JSON.stringify(event.simpleRouteJson),
  )
})
circuit.add(<NativeDdrBoard source={source} dataOnly />)
try {
  await circuit.renderUntilSettled()
} finally {
  writeFileSync(
    `${directory}/circuit.json`,
    JSON.stringify(circuit.getCircuitJson()),
  )
}
const circuitJson = circuit.getCircuitJson()
const requestedNames = new Set(
  source.traces
    .filter((trace) => trace.group !== "remaining")
    .map((trace) => trace.name),
)
const connections = circuit.db.source_trace
  .list()
  .filter((trace) => requestedNames.has(trace.name!))
const pcbMap = new PcbConnectivityMap(circuitJson)
const sourcePorts = new Map(
  circuit.db.pcb_port
    .list()
    .map((port) => [port.source_port_id, port.pcb_port_id]),
)
const connected = connections.every((trace) => {
  const ports = trace.connected_source_port_ids.map((id) => sourcePorts.get(id))
  return (
    ports.length >= 2 &&
    ports.every((id) => id !== undefined) &&
    pcbMap.connMap.areAllIdsConnected(ports)
  )
})
if (
  connections.length !== 32 ||
  !connected ||
  circuit.db.pcb_autorouting_error.list().length
)
  throw Error("A64 DQ routing incomplete; inspect the captured phase inputs")
writeFileSync(
  `${directory}/board.svg`,
  convertCircuitJsonToPcbSvg(circuitJson, { backgroundColor: "white" }),
)
