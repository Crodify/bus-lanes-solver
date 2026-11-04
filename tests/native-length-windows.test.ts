import { expect, test } from "bun:test"
import { nativeLengthWindows } from "../lib/native-length-windows"
import type { SimpleRouteJson, Trace } from "../lib/types"

const input: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.06,
  bounds: { minX: 0, maxX: 40, minY: 0, maxY: 40 },
  obstacles: [],
  connections: [],
  buses: [
    { busId: "data", connectionNames: ["dq0", "dq1"], maxLengthSkew: 0.5 },
    {
      busId: "command",
      connectionNames: ["ca0", "ca1"],
      minLength: 10,
      maxLength: 30,
      maxLengthSkew: 0.5,
    },
    {
      busId: "limited",
      connectionNames: ["a0", "a1"],
      maxLength: 13.5,
      maxLengthSkew: 0.1,
    },
    { busId: "reset", connectionNames: ["reset"] },
  ],
}
const paired: Trace[] = ["dq0", "dq1"].map((name, i) => ({
  type: "pcb_trace",
  pcb_trace_id: name,
  connection_name: name,
  route: [
    { route_type: "wire", layer: "inner1", width: 0.06, x: 0, y: i },
    { route_type: "wire", layer: "inner1", width: 0.06, x: 24 + i / 10, y: i },
  ],
}))

test("unpaired timing windows grow collectively while anchored buses and real length limits stay fixed", () => {
  const before = structuredClone(input)
  const windows = nativeLengthWindows(input, paired, {
    command: 20,
    limited: 12,
  })
  expect(windows.grow("ca0", 22.2)).toBe(true)
  for (const name of ["ca0", "ca1"]) {
    expect(windows.minimums.get(name)).toBe(22.5)
    expect(windows.maximums.get(name)).toBe(23)
  }
  expect(windows.grow("dq0", 28)).toBe(false)
  expect(windows.maximums.get("dq0")).toBeCloseTo(24.1)
  expect(windows.maximums.get("a0")).toBe(12)
  expect(windows.grow("a0", 20)).toBe(true)
  expect(windows.maximums.get("a1")).toBe(13.5)
  expect(windows.minimums.get("a1")).toBeCloseTo(13.4)
  expect(windows.grow("a0", 21)).toBe(false)
  expect(windows.maximums.has("reset")).toBe(false)
  expect(input).toEqual(before)
})

test("overlapping command constraints remain intersected after target growth", () => {
  const mixed = {
    ...input,
    buses: [
      ...input.buses!,
      {
        busId: "overlap",
        connectionNames: ["ca1"],
        maxLength: 21,
        maxLengthSkew: 0.25,
      },
    ],
  }
  const windows = nativeLengthWindows(mixed, paired, {
    command: 20,
    limited: 12,
    overlap: 20,
  })
  windows.grow("ca0", 22.2)
  expect(windows.maximums.get("ca0")).toBe(23)
  expect(windows.maximums.get("ca1")).toBe(20)
  expect(windows.minimums.get("ca1")).toBe(22.5) // Honest infeasible intersection; never silently relaxed.
})

test("unpaired bus hints must be measured finite lengths", () => {
  expect(() =>
    nativeLengthWindows(input, paired, { command: NaN, limited: 12 }),
  ).toThrow("finite and nonnegative")
  expect(() => nativeLengthWindows(input, paired, { limited: 12 })).toThrow(
    "needs a paired length anchor",
  )
})
