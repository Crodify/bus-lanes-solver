import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  BusLanesPipelineSolver,
  BusLanesSolver,
  type SimpleRouteJson,
} from "../../lib"
import capturedInput from "../fixtures/butterstick-shared-ddr/input.srj.json"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"

test("routes ButterStick's shared DDR byte to both RAM packages", async (): Promise<void> => {
  const input = capturedInput as SimpleRouteJson
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  let traces = input.traces
  let caption =
    "FAILED: 0/8 shared DDR signals; two-terminal guard rejects the RAM branch"
  let color = "#b91c1c"
  if (solver.solved) {
    expectCompletedRouting(solver, original)
    traces = solver.getOutput().traces
    caption =
      "COMPLETED: 8/8 shared DDR signals; all 24 endpoints connected; DRC passed"
    color = "#166534"
  }
  const graphics = new BusLanesSolver({ ...input, traces }).visualize()
  graphics.texts = [
    {
      x: Math.min(
        ...input.obstacles.map((pad) => pad.center.x - pad.width / 2),
      ),
      y:
        Math.max(
          ...input.obstacles.map((pad) => pad.center.y + pad.height / 2),
        ) + 1,
      text: caption,
      color,
      fontSize: 0.55,
      anchorSide: "bottom_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
})
