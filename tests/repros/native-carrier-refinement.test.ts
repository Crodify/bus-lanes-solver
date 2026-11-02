import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver, BusLanesSolver } from "../../lib"
import { carrierCompactionView } from "../../lib/carrier-compaction-view"
import { refineNativeCarrierSignals } from "../../lib/refine-native-carrier-signals"
import { length } from "../../lib/geometry"
import { sharedPairSpacingReports } from "../../lib/shared-pair-spacing"
import { exteriorPairSpacingReports } from "../../lib/exterior-pair-spacing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { matchNativeCarrierSignals } from "../../lib/match-native-carrier-signals"
import { toNativeValidationSrj } from "../../lib/native-validation-input"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"
import { pairCouplingReports } from "../../lib/pair-coupling"
import { nativeSignalGeometryIsValid } from "../../lib/native-signal-geometry"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import {
  crossedCarrierSeed,
  fixedNativeEscapes,
  nativeCarrierRefinement,
} from "../fixtures/native-carrier-refinement"

test("fixed-via refinement repairs a crossed interconnect with the original native endpoints", async () => {
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
  expect(result.value).not.toBeNull()
  const traces = result.value!
  expect(stages).toContain("native_fixed_via_repair")
  const native = {
    inputSrj: nativeInput,
    routedSrj: toNativeValidationSrj({ ...input, traces }),
  }
  const connectivity = validateOriginalEndpointConnectivity(native)
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(input.connections.length)
  const drc = validateRoutedCopperDrc({
    ...native,
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(drc.issues).toEqual([])
  for (const bus of busLengthReports(input, traces)) {
    expect(bus.aboveMinimumLength).toBe(true)
    expect(bus.withinLengthLimit).toBe(true)
    expect(bus.matched).toBe(true)
  }
  expect(pairLengthReports(input, traces).every((pair) => pair.matched)).toBe(
    true,
  )
  expect(pairCouplingReports(input, traces).every((pair) => pair.matched)).toBe(
    true,
  )
  expect(traces.every(nativeSignalGeometryIsValid)).toBe(true)
  for (const anchor of paired)
    expect(
      traces.find((trace) => trace.connection_name === anchor.connection_name),
    ).toEqual(anchor)
  for (const previous of ordinary)
    expect(
      fixedNativeEscapes(
        traces.find(
          (trace) => trace.connection_name === previous.connection_name,
        )!,
      ),
    ).toEqual(fixedNativeEscapes(previous))
  expect(seed).toEqual(seedBefore)
  expect(input).toEqual(before)
  expect(
    sharedPairSpacingReports(input, traces).every((pair) => pair.matched),
  ).toBe(true)
  expect(
    exteriorPairSpacingReports(input, traces).every((pair) => pair.matched),
  ).toBe(true)
  // Native DRC above uses original pad endpoints. This core validates the
  // planar carriers with the original vias and pad escapes held fixed.
  const view = carrierCompactionView(input, traces)
  expect(view).not.toBeNull()
  const validator = BusLanesSolver.forValidation(view!.input, view!.carriers, {
    smoothTuning: true,
  })
  validator.solve()
  expect(validator.solved).toBe(true)
  expect(validator.failed).toBe(false)
  expect(validator.error).toBeNull()
  const circuit = nativePairCircuit({ input, traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "completed-automatic-repair",
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

test("already valid native routes retain their existing copper", () => {
  const { input, options } = nativeCarrierRefinement()
  const before = structuredClone(input)
  const control = new BusLanesPipelineSolver(input, options)
  control.solve()
  expectCompletedRouting(control, before)
  const previous = structuredClone(control.traces)
  const names = input.differentialPairs![0].connectionNames
  const paired = control.traces.filter((trace) =>
    names.includes(trace.connection_name!),
  )
  const ordinary = control.traces.filter((trace) => !paired.includes(trace))
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
  expect(result.value).toEqual([...paired, ...ordinary])
  expect(stages).not.toContain("native_fixed_via_repair")
  expect(control.traces).toEqual(previous)
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

test("a fixed-escape collision remains available for joint negotiation", () => {
  const { input, options } = nativeCarrierRefinement()
  const before = structuredClone(input)
  const control = new BusLanesPipelineSolver(input, options)
  control.solve()
  expectCompletedRouting(control, before)
  const names = input.differentialPairs![0].connectionNames
  const paired = control.traces.filter((trace) =>
    names.includes(trace.connection_name!),
  )
  const ordinary = control.traces.filter((trace) => !paired.includes(trace))
  const first = ordinary.find((trace) => trace.connection_name === "DQ")!
  const neighbor = ordinary.find((trace) => trace.connection_name === "DQ2")!
  const crossed = ordinary.map((trace) =>
    trace === first
      ? {
          ...trace,
          route: [trace.route[0], neighbor.route[0], ...trace.route.slice(1)],
        }
      : trace,
  )
  const crossedBefore = structuredClone(crossed)
  const native = validateRoutedCopperDrc({
    inputSrj: toNativeValidationSrj(input),
    routedSrj: toNativeValidationSrj({
      ...input,
      traces: [...paired, ...crossed],
    }),
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(native.valid).toBe(false)
  const ceiling = Math.max(...paired.map((trace) => length(trace.route)))
  const minimums = new Map(
    ordinary.map((trace) => [
      trace.connection_name!,
      ceiling - input.buses![0].maxLengthSkew!,
    ]),
  )
  const maximums = new Map(
    ordinary.map((trace) => [trace.connection_name!, ceiling]),
  )
  const work = refineNativeCarrierSignals({
    input,
    paired,
    traces: crossed,
    minimums,
    maximums,
  })
  const result = work.next()
  expect(result.done).toBe(true)
  expect(result.value).toEqual(crossed)
  expect(crossed).toEqual(crossedBefore)
  expect(input).toEqual(before)
}, 60000)
