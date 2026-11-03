import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib/bus-lanes-pipeline-solver"
import { pinnedNativeBusesEligible } from "../../lib/route-pinned-native-buses"
import { inputHash, loadCase } from "../../repros/mt8395-lpddr4x/input"
import { renderRoutedSnapshot } from "../../repros/mt8395-lpddr4x/snapshot"
import { validateOutput } from "../../repros/mt8395-lpddr4x/validate"

for (const name of ["pair", "byte0"] as const) {
  test(`fresh exact core ${name} request completes with matched, coupled copper`, () => {
    const { input, metadata } = loadCase(name)
    const solver = new BusLanesPipelineSolver(input, {
      maxRoutingTimeMs: 60000,
    })
    solver.solve()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const output = solver.getOutput()
    expect(inputHash(input)).toBe(metadata.inputSha256)
    expect(output.allowedLayers).toBeUndefined()
    const validation = validateOutput(input, output)
    expect(validation.accepted).toBe(true)
    expect(validation.viaInPad).toEqual([])
    expect(output.traces!.length).toBe(input.connections.length)
    expect(renderRoutedSnapshot(input, metadata, output)).toContain(
      "ROUTED DDR",
    )
    expect(() =>
      renderRoutedSnapshot(input, metadata, {
        ...output,
        traces: output.traces!.slice(1),
      }),
    ).toThrow("complete, validated copper")
  }, 65000)
}

test("pinned native grouping does not claim overlapping, uncovered or supplied fanout requests", () => {
  for (const name of ["pair", "byte0", "full"] as const)
    expect(pinnedNativeBusesEligible(loadCase(name).input)).toBe(true)
  const { input } = loadCase("byte0")
  const before = inputHash(input)
  expect(pinnedNativeBusesEligible({ ...input, buses: [] })).toBe(false)
  expect(
    pinnedNativeBusesEligible({
      ...input,
      buses: [...input.buses!, input.buses![0]],
    }),
  ).toBe(false)
  expect(
    pinnedNativeBusesEligible({ ...input, allowedLayers: ["inner1"] }),
  ).toBe(false)
  expect(
    pinnedNativeBusesEligible({
      ...input,
      traces: [{ type: "pcb_trace", pcb_trace_id: "supplied", route: [] }],
    }),
  ).toBe(false)
  expect(inputHash(input)).toBe(before)
})
