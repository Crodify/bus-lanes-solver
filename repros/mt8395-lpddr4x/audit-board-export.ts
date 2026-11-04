import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, Trace } from "../../lib/types"

/** The routed board must preserve solver copper, not merely have trace IDs. */
export function auditBoardExport(
  input: SimpleRouteJson,
  output: SimpleRouteJson,
  circuit: { type: string }[],
) {
  // Published core may emit newer, unrelated element kinds than this repo's
  // pinned circuit-json version. Only these stable PCB/source kinds are read.
  const elements = <T extends AnyCircuitElement["type"]>(type: T) =>
    circuit.filter(
      (e): e is Extract<AnyCircuitElement, { type: T }> => e.type === type,
    )
  const sources = elements("source_trace")
  const traces = elements("pcb_trace")
  const vias = elements("pcb_via")
  const circuitErrors = circuit.filter((e) => e.type.endsWith("_error"))
  const issues: string[] = []
  const physicalRoute = (route: Trace["route"]) =>
    route.map((p) =>
      p.route_type === "wire"
        ? ["wire", p.x, p.y, p.layer, p.width]
        : [
            "via",
            p.x,
            p.y,
            p.from_layer,
            p.to_layer,
            p.via_diameter ?? input.minViaPadDiameter,
            p.via_hole_diameter ?? input.minViaHoleDiameter,
          ],
    )
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b)
  const fullStack = [
    "top",
    ...Array.from({ length: input.layerCount - 2 }, (_, i) => `inner${i + 1}`),
    "bottom",
  ]
  let expectedViaCount = 0
  if (
    sources.length !== input.connections.length ||
    traces.length !== input.connections.length
  )
    issues.push(
      "Export must contain one source and PCB trace for every requested connection",
    )
  for (const connection of input.connections) {
    const id = connection.source_trace_id ?? connection.name
    const originals = (output.traces ?? []).filter(
      (t) => t.connection_name === connection.name,
    )
    const exported = traces.filter((t) => t.source_trace_id === id)
    if (
      sources.filter((s) => s.source_trace_id === id).length !== 1 ||
      originals.length !== 1 ||
      exported.length !== 1
    ) {
      issues.push(`${id}: missing or duplicate source/solver/board trace`)
      continue
    }
    const original = originals[0],
      actual = exported[0] as unknown as Trace
    if (
      !same(physicalRoute(original.route), physicalRoute(actual.route)) ||
      !same(original.curvedSegments ?? [], actual.curvedSegments ?? [])
    )
      issues.push(`${id}: exported copper differs from accepted solver copper`)
    const expected = original.route
      .filter((p) => p.route_type === "via")
      .map((p) => [
        p.x,
        p.y,
        p.via_hole_diameter ?? input.minViaHoleDiameter,
        p.via_diameter ?? input.minViaPadDiameter,
        p.from_layer,
        p.to_layer,
        fullStack,
      ])
    const physical = vias
      .filter((v) => v.pcb_trace_id === actual.pcb_trace_id)
      .map((v) => [
        v.x,
        v.y,
        v.hole_diameter,
        v.outer_diameter,
        v.from_layer,
        v.to_layer,
        v.layers,
      ])
    expectedViaCount += expected.length
    const order = (items: unknown[]) =>
      items.map((item) => JSON.stringify(item)).sort()
    if (!same(order(expected), order(physical)))
      issues.push(`${id}: physical vias differ from accepted solver vias`)
  }
  if (vias.length !== expectedViaCount)
    issues.push("Export has missing or additional physical vias")
  return {
    accepted: !issues.length && !circuitErrors.length,
    sourceTraceCount: sources.length,
    pcbTraceCount: traces.length,
    viaCount: vias.length,
    expectedViaCount,
    circuitErrorCount: circuitErrors.length,
    issues,
  }
}
