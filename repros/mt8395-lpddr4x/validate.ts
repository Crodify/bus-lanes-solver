import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"
import { exteriorPairSpacingReports } from "../../lib/exterior-pair-spacing"
import { joinedSignalGeometryIsValid } from "../../lib/joined-signal-geometry"
import type { SimpleRouteJson } from "../../lib/types"

/** Manufacturing check independent of net ownership: a same-net drilled hole
 * overlapping its own SMT pad is still via-in-pad. This fixture has only circles.
 * Coordinates and dimensions are board-world mm, +X right, +Y up.
 */
export function viaInPadIssues(
  input: SimpleRouteJson,
  output: SimpleRouteJson,
) {
  if (input.allowViaInPad) return []
  const physical = [
    "top",
    ...Array.from({ length: input.layerCount - 2 }, (_, i) => `inner${i + 1}`),
    "bottom",
  ]
  const issues: {
    connectionName: string | undefined
    x: number
    y: number
    obstacleIndex: number
  }[] = []
  for (const trace of output.traces ?? []) {
    for (const via of trace.route) {
      if (via.route_type !== "via") continue
      const holeRadius =
        (via.via_hole_diameter ?? input.minViaHoleDiameter ?? 0) / 2
      const layers = !input.allowBlindAndBuriedVias
        ? physical
        : (via.layers ??
          physical.slice(
            Math.min(
              physical.indexOf(via.from_layer),
              physical.indexOf(via.to_layer),
            ),
            Math.max(
              physical.indexOf(via.from_layer),
              physical.indexOf(via.to_layer),
            ) + 1,
          ))
      input.obstacles.forEach((pad, obstacleIndex) => {
        if (
          !pad.componentId ||
          !pad.layers.some((layer) => layers.includes(layer))
        )
          return
        if (pad.shape !== "circle")
          throw Error("MT8395 pad audit expects circular SMT pads")
        if (
          Math.hypot(via.x - pad.center.x, via.y - pad.center.y) <
          holeRadius + pad.width / 2 - 1e-8
        )
          issues.push({
            connectionName: trace.connection_name,
            x: via.x,
            y: via.y,
            obstacleIndex,
          })
      })
    }
  }
  return issues
}
export function validateOutput(
  input: SimpleRouteJson,
  output: SimpleRouteJson,
) {
  // The core capture carries rect obstacle discriminators; the solver's
  // structural type is wider than the independent checker's nominal SRJ type.
  type CheckerInput = Parameters<
    typeof validateOriginalEndpointConnectivity
  >[0]["inputSrj"]
  const inputSrj = input as unknown as CheckerInput
  const routedSrj = output as unknown as CheckerInput
  const connectivity = validateOriginalEndpointConnectivity({
    inputSrj,
    routedSrj,
  })
  const drc = validateRoutedCopperDrc({
    inputSrj,
    routedSrj,
    clearance: input.minTraceToPadEdgeClearance ?? 0.06,
    allowBlindAndBuriedVias: false,
  })
  const buses = busLengthReports(input, output.traces ?? [])
  const pairs = pairLengthReports(input, output.traces ?? [])
  const coupling = exteriorPairSpacingReports(input, output.traces ?? [])
  const viaInPad = viaInPadIssues(input, output)
  const invalidGeometry = (output.traces ?? [])
    .filter((trace) => !joinedSignalGeometryIsValid({ input, trace }))
    .map((trace) => trace.connection_name)
  const complete =
    (output.traces?.length ?? 0) === input.connections.length &&
    connectivity.valid
  return {
    accepted:
      complete &&
      drc.valid &&
      !viaInPad.length &&
      !invalidGeometry.length &&
      buses.every(
        (b) =>
          b.aboveMinimumLength &&
          b.withinLengthLimit &&
          (b.toleranceMm === null || b.matched),
      ) &&
      pairs.every((p) => p.matched) &&
      coupling.every((p) => p.matched),
    complete,
    connectivity,
    drc,
    viaInPad,
    invalidGeometry,
    buses,
    pairs,
    coupling,
  }
}
