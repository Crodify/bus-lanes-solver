import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../../lib"
import { matchNativeCarrierSignals } from "../../lib/match-native-carrier-signals"
import { toNativeValidationSrj } from "../../lib/native-validation-input"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { pairCouplingReports } from "../../lib/pair-coupling"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import {
  crossedCarrierSeed,
  nativeCarrierRefinement,
} from "../fixtures/native-carrier-refinement"

test("native matching exhausts a crossed interconnect seed despite a legal fixed-via control", () => {
  const { input, options } = nativeCarrierRefinement()
  const before = structuredClone(input)
  const control = new BusLanesPipelineSolver(input, options)
  control.solve()
  expect(control.error).toBeNull()
  expectCompletedRouting(control, before)
  const seed = crossedCarrierSeed({ input, traces: control.traces })
  const seedBefore = structuredClone(seed)
  const paired = seed.filter((trace) =>
    input.differentialPairs![0].connectionNames.includes(
      trace.connection_name!,
    ),
  )
  const ordinary = seed.filter((trace) => !paired.includes(trace))
  const nativeInput = toNativeValidationSrj(input)
  const failed = validateRoutedCopperDrc({
    inputSrj: nativeInput,
    routedSrj: toNativeValidationSrj({ ...input, traces: seed }),
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(failed.valid).toBe(false)
  const stages: string[] = []
  const work = matchNativeCarrierSignals(
    input,
    paired,
    {
      carrierLayer: "inner1",
      ordinaryCarrierLayers: ["bottom"],
      maxPasses: 1,
      maxLocalPasses: 0,
      maxExpansionsPerRoute: 1,
    },
    (progress) => stages.push(progress.stage),
    ordinary,
  )
  let result = work.next()
  while (!result.done) result = work.next()
  expect(result.value).toBeNull()
  expect(stages).not.toContain("native_fixed_via_repair")
  expect(seed).toEqual(seedBefore)
  expect(input).toEqual(before)
}, 60000)

for (const stage of ["pipeline", "valid-seed"] as const)
  test(`completed ${stage} control preserves the original native copper`, async () => {
    const { input, options } = nativeCarrierRefinement()
    const before = structuredClone(input)
    const control = new BusLanesPipelineSolver(input, options)
    control.solve()
    expectCompletedRouting(control, before)
    if (stage === "valid-seed") {
      const names = input.differentialPairs![0].connectionNames
      const paired = control.traces.filter((trace) =>
        names.includes(trace.connection_name!),
      )
      const ordinary = control.traces.filter((trace) => !paired.includes(trace))
      const work = matchNativeCarrierSignals(
        input,
        paired,
        {
          carrierLayer: "inner1",
          ordinaryCarrierLayers: ["bottom"],
          maxPasses: 1,
          maxLocalPasses: 0,
          maxExpansionsPerRoute: 1,
        },
        undefined,
        ordinary,
      )
      let result = work.next()
      while (!result.done) result = work.next()
      expect(result.value).toEqual(control.traces)
    }
    expect(
      pairCouplingReports(input, control.traces).every((pair) => pair.matched),
    ).toBe(true)
    expectCompletedRouting(control, before)
    const circuit = nativePairCircuit({ input, traces: control.traces })
    await expect(circuit).toMatchPcbSnapshot({
      testPath: import.meta.path,
      snapshotName: `completed-${stage}-control`,
      svgOptions: {
        width: 1100,
        height: 750,
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
  }, 60000)
