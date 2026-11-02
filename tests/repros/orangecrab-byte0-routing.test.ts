import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { copyFileSync, writeFileSync } from "node:fs"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import { solveOrangecrabByte0 } from "../fixtures/orangecrab-routing"
import { orangecrabCircuit } from "../fixtures/orangecrab"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"

test.skipIf(process.env.RUN_ORANGECRAB_NATIVE_ROUTING !== "1")(
  "fresh OrangeCrab DDR byte completes every routing-model acceptance gate",
  async () => {
    const { solver, input, report } = await solveOrangecrabByte0()
    expectCompletedRouting(solver, input)
    expect(solver.solved).toBe(true)
    expect(report.connectivity.connectedConnectionCount).toBe(11)
    expect(report.drc.issues).toHaveLength(0)
    const wanted = new Set(solver.traces.map((trace) => trace.pcb_trace_id))
    const layers: PcbVia["layers"] = [
      "top",
      "inner1",
      "inner2",
      "inner3",
      "inner4",
      "bottom",
    ]
    const copper = nativePairCircuit({
      input: { ...input, obstacles: [], traces: [] },
      traces: solver.traces,
    }).flatMap((element): AnyCircuitElement[] => {
      if (element.type === "pcb_trace" && wanted.has(element.pcb_trace_id))
        return [element]
      if (element.type === "pcb_via") return [{ ...element, layers }]
      return []
    })
    // Reference fills require native refill after introducing new barrels.
    // Render the explicitly declared routing model, retaining all original
    // component/pad/hole/track geometry and intentional castellated drills.
    const circuit: AnyCircuitElement[] = [
      ...orangecrabCircuit(true).filter(
        (element) => !element.type.startsWith("pcb_copper_pour"),
      ),
      ...copper,
    ]
    writeFileSync(
      "work/orangecrab-byte0/completed-routing-model.circuit.json",
      JSON.stringify(circuit),
    )
    await expect(circuit).toMatchPcbSnapshot({
      testPath: import.meta.path,
      snapshotName: "completed-ddr",
      svgOptions: {
        width: 1800,
        height: 900,
        showSolderMask: false,
        hiddenLayerOpacity: 0.2,
        xRayElementIds: copper.flatMap((element) =>
          element.type === "pcb_trace"
            ? [element.pcb_trace_id]
            : element.type === "pcb_via"
              ? [element.pcb_via_id]
              : [],
        ),
      },
    })
    copyFileSync(
      new URL(
        "./__snapshots__/orangecrab-byte0-routing-completed-ddr.snap.svg",
        import.meta.url,
      ),
      "work/orangecrab-byte0/completed-ddr.svg",
    )
  },
  7800000,
)
