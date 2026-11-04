import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { SimpleRouteJson } from "../../lib/types"
import { auditBoardExport } from "./audit-board-export"
import { inputHash, loadCase, type CaseName } from "./input"
import { validateOutput } from "./validate"

export const circuitHash = (circuit: AnyCircuitElement[]) =>
  createHash("sha256").update(JSON.stringify(circuit)).digest("hex")

interface CoreReport {
  accepted: boolean
  solved: boolean
  failed: boolean
  inputUnchanged: boolean
  inputSha256: string
  outputSha256: string
  circuitSha256: string
}

/** Gate actual core-exported board pictures on both routing and export checks. */
export function validateBoardExport(
  input: SimpleRouteJson,
  output: SimpleRouteJson,
  circuit: AnyCircuitElement[],
  report: CoreReport,
) {
  if (
    !report.accepted ||
    !report.solved ||
    report.failed ||
    !report.inputUnchanged ||
    report.inputSha256 !== inputHash(input) ||
    report.outputSha256 !== inputHash(output) ||
    report.circuitSha256 !== circuitHash(circuit)
  )
    throw Error("Board export requires successful, hash-matched core output")
  const validation = validateOutput(input, output)
  const audit = auditBoardExport(input, output, circuit)
  if (!validation.accepted || !audit.accepted)
    throw Error(
      `Board export failed routing or copper-preservation checks: ${JSON.stringify(audit)}`,
    )
  return { validation, audit }
}

if (import.meta.main) {
  const scope = (process.argv[2] ?? "full") as CaseName
  if (!["full", "byte0", "pair"].includes(scope)) throw Error("Unknown scope")
  const directory = `${import.meta.dir}/results/core-routed-${scope}`
  const read = (name: string) =>
    JSON.parse(readFileSync(`${directory}/${name}`, "utf8"))
  const { input } = loadCase(scope)
  const circuit = read("circuit.json")
  validateBoardExport(
    input,
    read("accepted.srj.json"),
    circuit,
    read("report.json"),
  )
  for (const layer of [
    undefined,
    "top",
    "inner2",
    "inner4",
    "inner6",
  ] as const) {
    const svg = convertCircuitJsonToPcbSvg(circuit, {
      width: 1600,
      height: 1600,
      layer,
      showSolderMask: false,
      shouldDrawRatsNest: false,
      shouldDrawErrors: true,
      showErrorsInTextOverlay: true,
      includeVersion: false,
    })
    writeFileSync(`${directory}/board${layer ? `-${layer}` : ""}.svg`, svg)
  }
  console.log(`Exported validated ${scope} board and carrier-layer views`)
}
