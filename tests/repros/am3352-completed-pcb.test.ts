import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import { BusLanesPipelineSolver } from "../../lib"
import {
  am3352Hash,
  am3352SamplePlacements,
  loadAm3352Sample,
} from "../../scripts/am3352-samples"
import {
  validateAm3352OutputShape,
  validateAm3352Sample,
} from "../../scripts/validate-am3352-sample"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

const requestedSample = process.env.RUN_AM3352_PCB_SAMPLE
const placement = am3352SamplePlacements.find(
  (sample) => sample.name === requestedSample,
)

test.skipIf(!requestedSample)(
  `fresh completed AM3352 PCB snapshot: ${requestedSample ?? "on demand"}`,
  async () => {
    expect(placement).toBeDefined()
    const { input, metadata } = await loadAm3352Sample(placement!.name)
    const before = structuredClone(input)
    const initial = await validateAm3352Sample(input, metadata)
    expect(initial.fixedDrc.valid).toBe(true)
    const solver = new BusLanesPipelineSolver(input, {
      singleCarrier: { fixedConnections: metadata.powerConnections },
    })
    const started = performance.now()
    while (
      !solver.solved &&
      !solver.failed &&
      performance.now() - started < 3600000
    ) {
      solver.step()
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    const milliseconds = performance.now() - started
    expect(milliseconds).toBeLessThan(3600000)
    expectCompletedRouting(solver, before)
    const validation = await validateAm3352Sample(
      input,
      metadata,
      solver.traces,
    )
    expect(validation.valid).toBe(true)
    expect(validation.complete).toBe(true)
    expect(validation.matched).toBe(true)
    const output = solver.getOutput()
    validateAm3352OutputShape(input, metadata, solver.traces, output)
    expect(input).toEqual(before)
    expect(output.traces.slice(0, before.traces?.length ?? 0)).toEqual(
      before.traces ?? [],
    )
    expect(input.layerCount).toBe(4)
    const layers: PcbVia["layers"] = ["top", "inner1", "inner2", "bottom"]
    const circuit = nativePairCircuit({ input, traces: solver.traces }).map(
      (element): AnyCircuitElement =>
        element.type === "pcb_via" ? { ...element, layers } : element,
    )
    await expect(circuit).toMatchPcbSnapshot({
      testPath: import.meta.path,
      snapshotName: placement!.name,
      svgOptions: {
        width: 1500,
        height: 1200,
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
    mkdirSync("work/am3352", { recursive: true })
    await Bun.write(
      `work/am3352/${placement!.name}.summary.json`,
      JSON.stringify({
        sample: placement!.name,
        solved: solver.solved,
        inputSha256: am3352Hash(input),
        inputUnchanged: true,
        fixedCopperUnchanged: true,
        milliseconds,
        validation,
      }),
    )
    await Bun.write(
      `work/am3352/${placement!.name}.srj.json`,
      JSON.stringify(output),
    )
  },
  3720000,
)
