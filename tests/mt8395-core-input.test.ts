import { expect, test } from "bun:test"
import { caseNames, loadCase, inputHash } from "../repros/mt8395-lpddr4x/input"
import { renderInputSnapshot } from "../repros/mt8395-lpddr4x/snapshot"
import {
  validateOutput,
  viaInPadIssues,
} from "../repros/mt8395-lpddr4x/validate"

test("MT8395 captures retain all pad obstacles and exact core constraints", () => {
  for (const name of caseNames) {
    const { input, metadata } = loadCase(name)
    expect(input.connections.length).toBe(
      { full: 138, byte0: 11, pair: 2 }[name],
    )
    expect(input.obstacles).toHaveLength(1446)
    expect(
      ["pcb_component_0", "pcb_component_1", "pcb_component_2"].map(
        (id) =>
          input.obstacles.filter((obstacle) => obstacle.componentId === id)
            .length,
      ),
    ).toEqual([1046, 200, 200])
    expect(inputHash(input)).toBe(metadata.inputSha256)
    expect(input.allowedLayers).toBeUndefined()
    expect(input.allowViaInPad).toBe(false)
    expect(input.layerCount).toBe(8)
    expect(input.minTraceWidth).toBe(0.06)
    expect(input.minTraceToPadEdgeClearance).toBe(0.06)
    expect(input.minViaPadDiameter).toBe(0.2)
    expect(input.minViaHoleDiameter).toBe(0.1)
    expect(input.traces ?? []).toEqual([])
    expect(input.buses!.flatMap((bus) => bus.connectionNames).sort()).toEqual(
      input.connections.map((connection) => connection.name).sort(),
    )
    for (const connection of input.connections) {
      expect(connection.pointsToConnect).toHaveLength(2)
      for (const point of connection.pointsToConnect) {
        const pad = input.obstacles.filter(
          (obstacle) =>
            obstacle.connectedTo.includes(point.pcb_port_id!) &&
            Math.hypot(
              obstacle.center.x - point.x,
              obstacle.center.y - point.y,
            ) < 1e-8,
        )
        expect(pad).toHaveLength(1)
        expect(pad[0].shape).toBe("circle")
        expect(pad[0].connectedTo).toContain(connection.name)
        expect(point.layer).toBe("top")
      }
    }
    for (const pair of input.differentialPairs!) {
      expect(pair.lengthTolerance).toBe(0.1)
      expect(pair.traceGap).toBe(0.08)
    }
  }
})

test("diagnostic MT8395 renderer labels unrouted input and refuses copper", () => {
  const { input, metadata } = loadCase("full")
  const expected = renderInputSnapshot(input, metadata)
  expect(renderInputSnapshot(structuredClone(input), metadata)).toBe(expected)
  expect(expected).toContain("UNROUTED INPUT")
  expect(expected).toContain("11 unrouted requests")
  expect(() =>
    renderInputSnapshot(
      {
        ...input,
        traces: [{ type: "pcb_trace", pcb_trace_id: "partial", route: [] }],
      },
      metadata,
    ),
  ).toThrow("refuses routed or partial copper")
})

test("MT8395 acceptance rejects missing connections and same-net via-in-pad", () => {
  const { input } = loadCase("pair")
  expect(validateOutput(input, { ...input, traces: [] }).accepted).toBe(false)
  const connection = input.connections[0],
    pad = connection.pointsToConnect[0]
  const output = {
    ...input,
    traces: [
      {
        type: "pcb_trace" as const,
        pcb_trace_id: "same-net-via",
        connection_name: connection.name,
        route: [
          {
            route_type: "via" as const,
            x: pad.x,
            y: pad.y,
            from_layer: "top",
            to_layer: "inner2",
            via_hole_diameter: 0.1,
            via_diameter: 0.2,
          },
        ],
      },
    ],
  }
  expect(viaInPadIssues(input, output)).toHaveLength(1)
  expect(viaInPadIssues({ ...input, allowViaInPad: true }, output)).toEqual([])
})
