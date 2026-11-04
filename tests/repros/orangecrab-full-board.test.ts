import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { BusLanesPipelineSolver } from "../../lib"
import { orangecrabByte0, orangecrabCircuit } from "../fixtures/orangecrab"

test("the retained full-board OrangeCrab byte still fails coupled package approaches", async () => {
  const input = orangecrabByte0()
  const before = structuredClone(input)
  expect(input.connections).toHaveLength(11)
  expect(input.obstacles).toHaveLength(1430)
  expect(input.traces).toHaveLength(996)

  // Reproduce search exhaustion rather than a runner-dependent elapsed timeout.
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.failureCode).toBe("coupled_routing_failed")
  expect(solver.error).toBe("No legal coupled corridor and package approaches")
  expect(solver.traces).toEqual([])
  expect(() => solver.getOutput()).toThrow(
    "No legal coupled corridor and package approaches",
  )
  expect(solver.input).toEqual(before)
  expect(input).toEqual(before)

  const circuit = orangecrabCircuit(true)
  expect(
    circuit.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(163)
  // This view-only note labels the explicitly permitted failed baseline.
  // The original source fixture and every retained PCB element stay unchanged.
  const snapshot: AnyCircuitElement[] = [
    ...circuit,
    {
      type: "pcb_note_text",
      pcb_note_text_id: "orangecrab_full_board_status",
      font: "tscircuit2024",
      font_size: 0.8,
      anchor_position: { x: 0, y: 13.5 },
      anchor_alignment: "center",
      layer: "top",
      color: "#ff7777",
      text: "FAILED BASELINE: 0/11 NEW DDR ROUTES; RETAINED COPPER SHOWN",
    },
  ]
  await expect(snapshot).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1800,
      height: 950,
      showSolderMask: false,
      shouldDrawRatsNest: false,
      viewport: { minX: -27, maxX: 27, minY: -13, maxY: 15 },
    },
  })
}, 120_000)
