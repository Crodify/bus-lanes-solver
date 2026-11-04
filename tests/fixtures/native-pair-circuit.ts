import type {
  AnyCircuitElement,
  PcbBoard,
  PcbSmtPad,
  PcbTrace,
  PcbVia,
} from "circuit-json"
import type { SimpleRouteJson, Trace } from "../../lib"

function circuitLayer(layer: string) {
  const copperLayer = (
    [
      "top",
      "inner1",
      "inner2",
      "inner3",
      "inner4",
      "inner5",
      "inner6",
      "bottom",
    ] as const
  ).find((candidate) => candidate === layer)
  if (!copperLayer)
    throw Error(`Unsupported Circuit JSON copper layer: ${layer}`)
  return copperLayer
}

/** Map actual synthetic fixture geometry to Circuit JSON for the shared matcher. */
export function nativePairCircuit({
  input,
  traces,
}: {
  input: SimpleRouteJson
  traces: Trace[]
}): AnyCircuitElement[] {
  const bounds = input.bounds
  const num_layers = ([2, 4, 6, 8] as const).find(
    (count) => count === input.layerCount,
  )
  if (!num_layers) throw Error("Unsupported snapshot layer count")
  const board: PcbBoard = {
    type: "pcb_board",
    pcb_board_id: "board",
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    outline: input.outline ?? [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ],
    thickness: 1.6,
    material: "fr4",
    num_layers,
    min_board_edge_clearance: input.minBoardEdgeClearance,
  }
  const terminals = input.connections.flatMap(
    (connection) => connection.pointsToConnect,
  )
  const pads: PcbSmtPad[] = terminals.map((terminal, index) => ({
    type: "pcb_smtpad",
    pcb_smtpad_id: `pad_${index}`,
    pcb_port_id: terminal.pcb_port_id ?? `port_${index}`,
    shape: "circle",
    x: terminal.x,
    y: terminal.y,
    radius:
      (input.obstacles.find(
        (obstacle) =>
          obstacle.center.x === terminal.x && obstacle.center.y === terminal.y,
      )?.width ?? input.minTraceWidth) / 2,
    layer: circuitLayer(terminal.layer),
  }))
  const copper: PcbTrace[] = [...(input.traces ?? []), ...traces].map(
    (trace) => ({
      type: "pcb_trace",
      pcb_trace_id: trace.pcb_trace_id,
      source_trace_id: trace.source_trace_id,
      route: trace.route.map((point) =>
        point.route_type === "wire"
          ? { ...point, layer: circuitLayer(point.layer) }
          : {
              ...point,
              from_layer: circuitLayer(point.from_layer),
              to_layer: circuitLayer(point.to_layer),
              via_diameter:
                point.via_diameter ?? input.minViaPadDiameter ?? 0.3,
              via_hole_diameter:
                point.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15,
            },
      ),
    }),
  )
  const vias: PcbVia[] = [...(input.traces ?? []), ...traces].flatMap((trace) =>
    trace.route.flatMap((point, index) =>
      point.route_type === "via"
        ? [
            {
              type: "pcb_via" as const,
              pcb_via_id: `${trace.pcb_trace_id}_via_${index}`,
              x: point.x,
              y: point.y,
              outer_diameter: point.via_diameter ?? 0.3,
              hole_diameter: point.via_hole_diameter ?? 0.15,
              layers: (
                point.layers ?? [point.from_layer, point.to_layer]
              ).map(circuitLayer),
            },
          ]
        : [],
    ),
  )
  return [board, ...pads, ...copper, ...vias]
}
