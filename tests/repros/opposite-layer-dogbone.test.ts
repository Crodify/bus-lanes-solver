import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { routeLocalSignalDogbones } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../../lib"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { oppositeLayerDogboneControl } from "../fixtures/opposite-layer-dogbone"

test("a backside pad wrongly rejects TOP dogbones and forces a completed TOP fallback", async () => {
  const { input, circuitJson } = oppositeLayerDogboneControl()
  const before = structuredClone(input)
  expect(() =>
    routeLocalSignalDogbones(input, {
      targetLayers: new Map([["signal", "inner1"]]),
      traceWidth: 0.1,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      clearance: 0.1,
      holeToHoleClearance: 0.1,
      allowBlindAndBuriedVias: false,
    }),
  ).toThrow("No collision-free local dogbone assignment")
  expect(input).toEqual(before)

  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expectCompletedRouting(solver, before)
  expect(
    solver.traces.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
  ).toHaveLength(0)
  const routedCopper = nativePairCircuit({
    input,
    traces: solver.traces,
  }).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  await expect([...circuitJson, ...routedCopper]).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1200,
      height: 600,
      showSolderMask: false,
      shouldDrawRatsNest: false,
    },
  })
})
