import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { SimpleRouteJson } from "../lib/types"
import { auditBoardExport } from "../repros/mt8395-lpddr4x/audit-board-export"
import { validateBoardExport } from "../repros/mt8395-lpddr4x/board-export"
import { loadCase } from "../repros/mt8395-lpddr4x/input"

const root = new URL("../repros/mt8395-lpddr4x/", import.meta.url)
const readCompressed = (name: string) =>
  JSON.parse(
    gunzipSync(
      readFileSync(new URL(`routed/${name}.json.gz`, root)),
    ).toString(),
  )
const circuit: AnyCircuitElement[] = readCompressed("core-full.circuit")
const output: SimpleRouteJson = readCompressed("full.srj")
const { input } = loadCase("full")
const report = JSON.parse(
  readFileSync(new URL("routed/core-full-report.json", root), "utf8"),
)

test("retained native core board preserves all 138 validated routes and 276 physical vias", () => {
  const { audit } = validateBoardExport(input, output, circuit, report)
  expect(audit).toEqual({
    accepted: true,
    sourceTraceCount: 138,
    pcbTraceCount: 138,
    viaCount: 276,
    expectedViaCount: 276,
    circuitErrorCount: 0,
    issues: [],
  })
  const svg = convertCircuitJsonToPcbSvg(circuit, {
    width: 1600,
    height: 1600,
    showSolderMask: false,
    shouldDrawRatsNest: false,
    shouldDrawErrors: true,
    showErrorsInTextOverlay: true,
    includeVersion: false,
  })
  expect(createHash("sha256").update(svg).digest("hex")).toBe(
    readFileSync(new URL("routed/core-board-svg.sha256", root), "utf8").trim(),
  )
  expect(() =>
    validateBoardExport(input, output, circuit, { ...report, solved: false }),
  ).toThrow("successful, hash-matched")
  expect(() =>
    validateBoardExport(input, output, circuit.slice(1), report),
  ).toThrow("successful, hash-matched")
}, 300000)

test("board acceptance rejects omitted copper, duplicate connections and displaced drill holes", () => {
  const changed = structuredClone(circuit)
  const traces = changed.filter((e) => e.type === "pcb_trace")
  const first = traces[0]
  const route = first.route
  first.route = route.slice(1)
  expect(
    auditBoardExport(input, output, changed).issues.some((s) =>
      s.includes("exported copper"),
    ),
  ).toBe(true)
  first.route = route
  const source = first.source_trace_id
  first.source_trace_id = traces[1].source_trace_id
  expect(auditBoardExport(input, output, changed).accepted).toBe(false)
  first.source_trace_id = source
  expect(
    auditBoardExport(
      input,
      output,
      changed.filter((e) => e !== first),
    ).accepted,
  ).toBe(false)
  const via = changed.find((e) => e.type === "pcb_via")!
  via.x += 0.2
  expect(
    auditBoardExport(input, output, changed).issues.some((s) =>
      s.includes("physical vias"),
    ),
  ).toBe(true)
})
