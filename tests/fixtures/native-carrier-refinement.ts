import type { SimpleRouteJson, Trace, Wire } from "../../lib"
import { nativeCarrierAlternatives } from "./native-carrier-alternatives"

/** Fresh completed native routes provide immutable escapes and a paired anchor.
 * A crossed interconnect seed is constructed locally; no saved route is loaded. */
export function nativeCarrierRefinement() {
  const { input, options } = nativeCarrierAlternatives()
  input.obstacles = input.obstacles.filter(
    (obstacle) => !obstacle.connectedTo.includes("immutable_wall"),
  )
  const second = {
    name: "DQ2",
    pointsToConnect: [
      { x: -6, y: 3.8, layer: "top" },
      { x: 6, y: 3.8, layer: "top" },
    ],
  }
  input.connections.push(second)
  input.buses![0].connectionNames.push(second.name)
  for (const [index, point] of second.pointsToConnect.entries())
    input.obstacles.push({
      type: "rect",
      shape: "circle",
      componentId: `package_${index}`,
      center: { x: point.x, y: point.y },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: [second.name],
    })
  options.singleCarrier.ordinaryCarrierLayers = ["bottom"]
  options.singleCarrier.busTargetLength = 12
  options.maxRoutingTimeMs = 20000
  return { input, options }
}

export function crossedCarrierSeed({
  input,
  traces,
}: {
  input: SimpleRouteJson
  traces: Trace[]
}) {
  const signal = traces.find((trace) => trace.connection_name === "DQ")!
  const neighbor = traces.find((trace) => trace.connection_name === "DQ2")!
  const vias = signal.route.flatMap((point, index) =>
    point.route_type === "via" ? [index] : [],
  )
  if (vias.length !== 2) throw Error("Expected two plated signal vias")
  const [firstVia, lastVia] = vias
  const wire = neighbor.route.find(
    (point): point is Wire =>
      point.route_type === "wire" && point.layer === "bottom",
  )!
  const crossing = { ...wire, width: input.minTraceWidth }
  const crossed: Trace = {
    ...signal,
    curvedSegments: undefined,
    route: [
      ...signal.route.slice(0, firstVia + 2),
      crossing,
      ...signal.route.slice(lastVia - 1),
    ],
  }
  return traces.map((trace) => trace === signal ? crossed : trace)
}

export function fixedNativeEscapes(trace: Trace) {
  const vias = trace.route.flatMap((point, index) =>
    point.route_type === "via" ? [index] : [],
  )
  if (vias.length !== 2) throw Error("Expected two plated signal vias")
  return [
    trace.route.slice(0, vias[0] + 2),
    trace.route.slice(vias[1] - 1),
  ]
}
