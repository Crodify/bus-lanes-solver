import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { nativeSignalGeometryIsValid } from "../lib/native-signal-geometry"

test("STMP157 byte3 preserves the first three bytes and completes every pad escape", async (): Promise<void> => {
  // Captured from the native STMP157 TSX board through published core 0.0.2260.
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL("./fixtures/stmp157-byte3/input.srj.json.gz", import.meta.url),
      ),
    ).toString("utf8"),
  )
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(input).toEqual(before)
  if (solver.solved) {
    expect(solver.failed).toBe(false)
    expect(solver.traces).toHaveLength(8)
    const output = solver.getOutput()
    expect(output.traces.slice(0, 24)).toEqual(before.traces!)
    for (const connection of input.connections) {
      const trace = solver.traces.find(
        (trace) => trace.connection_name === connection.name,
      )!
      expect(nativeSignalGeometryIsValid(trace)).toBe(true)
      const endpoints = [trace.route[0], trace.route.at(-1)]
      for (const [index, terminal] of connection.pointsToConnect.entries()) {
        expect(endpoints[index]).toMatchObject({
          x: terminal.x,
          y: terminal.y,
          layer: terminal.layer,
        })
      }
    }
    const validationInput = {
      ...input,
      connections: [
        ...input.connections,
        ...input.traces!.map((trace) => ({
          name: trace.connection_name!,
          pointsToConnect: [trace.route[0], trace.route.at(-1)!],
        })),
      ],
    }
    const drc = validateRoutedCopperDrc({
      inputSrj: validationInput as never,
      routedSrj: output as never,
      clearance: input.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    })
    expect(drc).toMatchObject({ valid: true })
  }
  const graphics: GraphicsObject = solver.visualize()
  const status = {
    text: "FAILED: 0/8 accepted; 24 supplied traces; unaccepted candidate copper shown",
    color: "#b91c1c",
  }
  if (solver.solved) {
    status.text =
      "COMPLETED: 8/8 new signals; 24 supplied traces unchanged; DRC passed"
    status.color = "#166534"
  }
  graphics.texts = [
    {
      x: Math.min(
        ...input.obstacles.map((pad) => pad.center.x - pad.width / 2),
      ),
      y:
        Math.max(
          ...input.obstacles.map((pad) => pad.center.y + pad.height / 2),
        ) + 1,
      text: status.text,
      color: status.color,
      fontSize: 0.55,
      anchorSide: "bottom_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
}, 120_000)
