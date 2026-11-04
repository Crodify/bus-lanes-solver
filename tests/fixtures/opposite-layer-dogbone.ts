import type { AnyCircuitElement } from "circuit-json"
import type { routeLocalSignalDogbones } from "@tscircuit/fanout-solver"
import type { SimpleRouteJson } from "../../lib"
import { nativePairCircuit } from "./native-pair-circuit"

/** A backside pad overlaps a TOP terminal, while every through-via site stays clear. */
export function oppositeLayerDogboneControl() {
  const input: SimpleRouteJson &
    Parameters<typeof routeLocalSignalDogbones>[0] = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    allowBlindAndBuriedVias: false,
    allowedLayers: ["top", "inner1", "bottom"],
    bounds: { minX: -2, maxX: 15, minY: -2, maxY: 5 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0.8, y: 0.8, layer: "top", pcb_port_id: "driver_port" },
          { x: 10.8, y: 0.8, layer: "top", pcb_port_id: "receiver_port" },
        ],
      },
    ],
    obstacles: [0, 10].flatMap((offset) =>
      Array.from({ length: 16 }, (_, index) => ({
        type: "rect" as const,
        componentId: offset === 0 ? "driver" : "receiver",
        shape: "circle" as const,
        center: {
          x: offset + (index % 4) * 0.8,
          y: Math.floor(index / 4) * 0.8,
        },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: index === 5 ? ["signal"] : [],
      })),
    ),
  }
  input.obstacles.push({
    type: "rect",
    componentId: "backside",
    center: { x: 0.8, y: 0.8 },
    width: 0.08,
    height: 0.08,
    layers: ["bottom"],
    connectedTo: ["other"],
  })
  const circuitJson: AnyCircuitElement[] = nativePairCircuit({
    input,
    traces: [],
  })
  // The existing fixture adapter supplies the board and terminal pads. Retain
  // every other physical pad here, including the obstructing BOTTOM pad.
  for (const [index, obstacle] of input.obstacles.entries()) {
    const layer = obstacle.layers[0] === "bottom" ? "bottom" : "top"
    if (
      layer === "top" &&
      input.connections[0].pointsToConnect.some(
        (point) =>
          point.x === obstacle.center.x && point.y === obstacle.center.y,
      )
    )
      continue
    const pad = {
      type: "pcb_smtpad" as const,
      pcb_smtpad_id: `obstacle_pad_${index}`,
      pcb_port_id: `obstacle_port_${index}`,
      x: obstacle.center.x,
      y: obstacle.center.y,
      layer,
    } as const
    circuitJson.push(
      obstacle.shape === "circle"
        ? { ...pad, shape: "circle", radius: obstacle.width / 2 }
        : {
            ...pad,
            shape: "rect",
            width: obstacle.width,
            height: obstacle.height,
          },
    )
  }
  return { input, circuitJson }
}
