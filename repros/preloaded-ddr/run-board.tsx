import { mkdirSync, writeFileSync } from "node:fs"
import { RootCircuit } from "tscircuit"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

const id = process.argv[2]
const directory = process.argv[3] ?? `results/${id}`
mkdirSync(directory, { recursive: true })
const { board } = await import(`./circuits/${id}.tsx`)
const circuit = new RootCircuit()
let phaseEventCount = 0
circuit.on("autorouting:start", (event) => {
  phaseEventCount++
  writeFileSync(
    `${directory}/phase-${phaseEventCount}-input.srj.json`,
    JSON.stringify(event.simpleRouteJson),
  )
  console.log(`START ${event.phaseName}`)
})
circuit.on("autorouting:end", (event) => {
  phaseEventCount++
  writeFileSync(
    `${directory}/phase-${phaseEventCount}-output.srj.json`,
    JSON.stringify(event.simpleRouteJson),
  )
  console.log(`END ${event.phaseName}`)
})
circuit.add(board)
await circuit.renderUntilSettled()
const circuitJson = circuit.getCircuitJson()
writeFileSync(`${directory}/circuit.json`, JSON.stringify(circuitJson))
writeFileSync(
  `${directory}/board.svg`,
  convertCircuitJsonToPcbSvg(circuitJson, { backgroundColor: "white" }),
)
