import { expect } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  BusLanesPipelineSolver,
  BusLanesSolver,
  type Connection,
  type SimpleRouteJson,
} from "../../lib"
import { nativeSignalGeometryIsValid } from "../../lib/native-signal-geometry"
import { expectCompletedRouting } from "./expect-completed-routing"

export async function expectPreloadedByteRouting({
  fixtureName,
  testPath,
}: {
  fixtureName: string
  testPath: string
}): Promise<void> {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(new URL(`./${fixtureName}/input.srj.json.gz`, import.meta.url)),
    ).toString("utf8"),
  )
  const fixedConnections: Connection[] = JSON.parse(
    readFileSync(
      new URL(`./${fixtureName}/fixed-connections.json`, import.meta.url),
      "utf8",
    ),
  )
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    maxSearchIterations: 60_000,
    singleCarrier: { fixedConnections },
  })
  while (!solver.solved && !solver.failed && solver.iterations < 60_000)
    solver.step()
  if (!solver.solved && !solver.failed) solver.tryFinalAcceptance()
  expect(input).toEqual(original)
  expect(input.connections).toHaveLength(8)
  if (solver.solved) {
    expectCompletedRouting(solver, original)
    expect(solver.traces).toHaveLength(8)
    for (const trace of solver.traces)
      expect(nativeSignalGeometryIsValid(trace)).toBe(true)
  }
  // The red repro shows only the supplied, previously completed byte copper.
  // Newly accepted copper is shown only after the complete output passes DRC.
  const graphics = new BusLanesSolver({
    ...input,
    traces: solver.solved ? solver.getOutput().traces : input.traces,
  }).visualize()
  let caption = `FAILED: 0/8 new routes accepted; ${input.traces!.length} supplied routes shown`
  let color = "#b91c1c"
  if (solver.solved) {
    caption = `COMPLETED: 8/8 new routes; ${input.traces!.length} supplied routes unchanged; DRC passed`
    color = "#166534"
  }
  graphics.texts = [{
    x: Math.min(...input.obstacles.map((pad) => pad.center.x - pad.width / 2)),
    y: Math.max(...input.obstacles.map((pad) => pad.center.y + pad.height / 2)) + 1,
    text: caption,
    color,
    fontSize: 0.55,
    anchorSide: "bottom_left",
  }]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(testPath)
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
}
