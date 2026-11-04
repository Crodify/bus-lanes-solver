import {
  finishGeneratedSurfaceCarriers,
  type CompletedGeneratedSurfaceCarriers,
} from "./finish-generated-surface-carriers"
import { negotiateSignalSites } from "./negotiate-signal-sites"
import { runBoundedRouting } from "./run-bounded-routing"
import type { SimpleRouteJson, SolverOptions } from "./types"

/** Keep new pad approaches and carrier layers negotiable when adjacent via
 * allocation falls back to the native surface. Supplied copper remains fixed. */
export function* routeGeneratedSignalSites({
  input,
  options,
  maxSteps,
}: {
  input: SimpleRouteJson
  options: SolverOptions
  maxSteps: number
}): Generator<void, CompletedGeneratedSurfaceCarriers | null> {
  const routed = yield* runBoundedRouting(
    negotiateGeneratedSignalSites(input),
    maxSteps,
  )
  if (!routed) return null
  return yield* finishGeneratedSurfaceCarriers({
    input,
    carriers: routed.traces,
    escapes: routed.escapes,
    options,
    maxSteps,
  })
}

function* negotiateGeneratedSignalSites(
  input: SimpleRouteJson,
): ReturnType<typeof negotiateSignalSites> {
  // Preserve the original search before allowing pad-edge escape sites.
  for (const allowPadEdgeSites of [false, true]) {
    const routed = yield* negotiateSignalSites(
      { native: input, pending: input, escapes: [], retained: [], traces: [] },
      new Set(input.connections.map((connection) => connection.name)),
      false,
      true,
      {
        checkEscapeCompatibility: true,
        allowExpandedSites: true,
        expandEmptyDomainsOnly: !allowPadEdgeSites,
        allowPadEdgeSites,
        maxCandidateSearchNodes: 12000,
      },
    )
    if (routed) return routed
  }
  return null
}
