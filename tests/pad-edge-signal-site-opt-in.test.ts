import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  expandedSignalSiteChoices,
  type ExpandedSignalSiteChoice,
} from "../lib/expanded-signal-sites"
import { distance } from "../lib/geometry"
import type { SimpleRouteJson } from "../lib/types"

function collectChoices(
  search: ReturnType<typeof expandedSignalSiteChoices>,
): ExpandedSignalSiteChoice[] {
  let result = search.next()
  let steps = 0
  while (!result.done && steps++ < 10000) result = search.next()
  if (!result.done) {
    search.return([])
    throw Error("Site search exceeded its test budget")
  }
  return result.value
}

test("A64 pad-edge sites require explicit opt-in and keep drills outside their pads", () => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/a64-preloaded-byte3/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  )
  const original = structuredClone(input)
  const request = {
    input,
    connection: input.connections[0],
    targetLayer: "bottom",
  }
  expect(collectChoices(expandedSignalSiteChoices(request))).toEqual([])
  const choices = collectChoices(
    expandedSignalSiteChoices({ ...request, allowPadEdgeSites: true }),
  )
  expect(choices.length).toBeGreaterThan(0)
  for (const choice of choices)
    for (const escape of choice.escapes) {
      const via = escape.route.find((point) => point.route_type === "via")
      const pad = input.obstacles.find(
        (obstacle) => distance(obstacle.center, escape.route[0]) < 1e-8,
      )
      if (!via || !pad)
        throw Error("Expected a generated dogbone and its native pad")
      expect(distance(via, pad.center)).toBeGreaterThanOrEqual(
        (pad.width + input.minViaHoleDiameter!) / 2,
      )
    }
  expect(input).toEqual(original)
})
