import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { NativeCarrierRouter } from "../lib/native-carrier-router"
import { tuneNativeCarrierSignal } from "../lib/native-carrier-tuning"
import { joinedSignalGeometryIsValid } from "../lib/joined-signal-geometry"
import { length } from "../lib/geometry"
import type { SimpleRouteJson } from "../lib/types"

test("a native lane can extend its timing window without discarding an existing curved bank", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    allowViaInPad: false,
    bounds: { minX: -8, maxX: 8, minY: -4, maxY: 4 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -6, y: 0, layer: "top" },
          { x: 6, y: 0, layer: "top" },
        ],
      },
    ],
    obstacles: [-6, 6].map((x, i) => ({
      type: "rect",
      shape: "circle",
      componentId: `package_${i}`,
      center: { x, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["signal"],
    })),
  }
  const before = structuredClone(input)
  const router = new NativeCarrierRouter(input, 0.1, [
    new Float32Array(161 * 81),
    new Float32Array(161 * 81),
  ])
  const search = router.route(input.connections[0])
  let result = search.next()
  while (!result.done) result = search.next()
  const first = tuneNativeCarrierSignal(
    input,
    input.connections[0],
    result.value!.trace,
    14,
    14.1,
    [],
  )!
  expect(first).not.toBeNull()
  expect(first.curvedSegments!.length).toBeGreaterThan(0)
  const firstCopy = structuredClone(first)
  const extended = tuneNativeCarrierSignal(
    input,
    input.connections[0],
    first,
    16,
    16.1,
    [],
    undefined,
    8192,
    true,
  )!
  expect(extended).not.toBeNull()
  expect(length(extended.route)).toBeCloseTo(16, 6)
  expect(joinedSignalGeometryIsValid({ input, trace: extended })).toBe(true)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: [extended] },
      clearance: 0.1,
    } as never).valid,
  ).toBe(true)
  expect(extended.route.filter((p) => p.route_type === "via")).toEqual(
    first.route.filter((p) => p.route_type === "via"),
  )
  for (const index of first.curvedSegments!) {
    const old = first.route[index]
    expect(
      extended.route.some((p) => Math.hypot(p.x - old.x, p.y - old.y) < 1e-8),
    ).toBe(true)
  }
  expect(first).toEqual(firstCopy)
  expect(input).toEqual(before)
})
