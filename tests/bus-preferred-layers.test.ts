import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { SimpleRouteJson } from "../lib/types"

test("bus preferredLayers steers carrier choice for size-2 pair bus", () => {
  const connections = [-1, 1].map((x, i) => ({
    name: `PAIR_${i}`,
    pointsToConnect: [
      { x, y: 3, layer: "top" },
      { x, y: -3, layer: "top" },
    ],
  }))

  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.5,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections,
    obstacles: connections.flatMap((c) =>
      c.pointsToConnect.map((p, i) => ({
        center: { x: p.x, y: p.y },
        width: 0.25,
        height: 0.25,
        layers: ["top"],
        connectedTo: [c.name],
        componentId: `U${i}`,
      })),
    ),
    buses: [
      {
        busId: "PAIR_BUS",
        connectionNames: connections.map((c) => c.name),
        allowedLayers: ["top", "bottom"],
        preferredLayers: ["bottom"],
      },
    ],
    traces: [],
  }

  const solver = new BusLanesPipelineSolver(input, {
    smoothTuning: false,
    denseSearch: false,
    maxSearchIterations: 2000,
  })

  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)

  // Every trace of this pair should be carried on the preferred 'bottom' layer
  const traces = solver.traces
  expect(traces.length).toBe(2)
  for (const trace of traces) {
    const routeLayers = trace.route.flatMap((p) =>
      "layer" in p ? [p.layer] : [p.from_layer, p.to_layer],
    )
    expect(routeLayers).toContain("bottom")
  }
})
