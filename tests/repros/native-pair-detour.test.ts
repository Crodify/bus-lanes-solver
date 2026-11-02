import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { pairCouplingReports } from "../../lib/pair-coupling"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { nativePairDetour } from "../fixtures/native-pair-detour"
import { offsetNativePair } from "../fixtures/offset-native-pair"
import type { Point } from "../../lib/types"

test("automatic pair planning finds a clear detour around a fixed wall", async () => {
  const { input } = nativePairDetour()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    maxRoutingTimeMs: 20000,
  })
  solver.solve()
  expectCompletedRouting(solver, before)
  expect(
    pairCouplingReports(input, solver.traces).every((pair) => pair.matched),
  ).toBe(true)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "automatic-detour",
    svgOptions: {
      width: 1000,
      height: 650,
      showSolderMask: false,
      hiddenLayerOpacity: 1,
      xRayElementIds: circuit.flatMap((element) =>
        element.type === "pcb_trace"
          ? [element.pcb_trace_id]
          : element.type === "pcb_smtpad"
            ? [element.pcb_smtpad_id]
            : [],
      ),
    },
  })
}, 30000)

for (const orientation of ["vertical", "mirrored", "omitted gap"] as const)
  test(`automatic detours retain clearance with ${orientation} geometry`, () => {
    const { input } = nativePairDetour()
    if (orientation === "omitted gap")
      delete input.differentialPairs![0].traceGap
    else {
      const transform = (point: Point): Point =>
        orientation === "vertical"
          ? { x: -point.y, y: point.x }
          : { x: -point.x, y: point.y }
      for (const connection of input.connections)
        connection.pointsToConnect = connection.pointsToConnect.map(
          (point) => ({ ...point, ...transform(point) }),
        )
      for (const obstacle of input.obstacles) {
        obstacle.center = transform(obstacle.center)
        if (orientation === "vertical")
          obstacle.ccwRotationDegrees = (obstacle.ccwRotationDegrees ?? 0) + 90
      }
      if (orientation === "vertical")
        input.bounds = { minX: -5, maxX: 5, minY: -8, maxY: 8 }
    }
    const before = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input, {
      maxRoutingTimeMs: 60000,
    })
    solver.solve()
    expectCompletedRouting(solver, before)
    expect(
      pairCouplingReports(input, solver.traces).every((pair) => pair.matched),
    ).toBe(true)
  }, 70000)

for (const control of ["direct", "explicit-detour"] as const)
  test(`the completed ${control} positive control passes every routing gate`, async () => {
    const fixture = nativePairDetour()
    const input = control === "direct" ? offsetNativePair() : fixture.input
    const before = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input, {
      maxRoutingTimeMs: 20000,
      singleCarrier:
        control === "explicit-detour"
          ? { centerlines: fixture.centerlines }
          : undefined,
    })
    solver.solve()
    expectCompletedRouting(solver, before)
    expect(
      pairCouplingReports(input, solver.traces).every((pair) => pair.matched),
    ).toBe(true)
    const circuit = nativePairCircuit({ input, traces: solver.traces })
    await expect(circuit).toMatchPcbSnapshot({
      testPath: import.meta.path,
      snapshotName: control,
      svgOptions: {
        width: 1000,
        height: 650,
        showSolderMask: false,
        hiddenLayerOpacity: 1,
        xRayElementIds: circuit.flatMap((element) =>
          element.type === "pcb_trace"
            ? [element.pcb_trace_id]
            : element.type === "pcb_smtpad"
              ? [element.pcb_smtpad_id]
              : [],
        ),
      },
    })
  }, 30000)
