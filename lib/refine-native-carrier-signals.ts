import { BusLanesSolver } from "./bus-lanes-solver"
import { CopperConflictIndex } from "./copper-conflict-index"
import { joinSignalEscapes } from "./join-signal-escapes"
import { fixedCopper } from "./vector-scene"
import type { SimpleRouteJson, Trace } from "./types"

/** Repair interconnect copper before moving already legal pad escapes and vias.
 * Other signals remain hard copper; the caller validates the complete result. */
export function* refineNativeCarrierSignals({
  input,
  paired,
  traces,
  minimums,
  maximums,
}: {
  input: SimpleRouteJson
  paired: Trace[]
  traces: Trace[]
  minimums: ReadonlyMap<string, number>
  maximums: ReadonlyMap<string, number>
}): Generator<void, Trace[]> {
  let result = traces
  const conflicts = new CopperConflictIndex()
  const copper = new WeakMap<Trace, ReturnType<typeof fixedCopper>>()
  const physical = (trace: Trace) => {
    let stored = copper.get(trace)
    if (!stored) {
      stored = fixedCopper({ ...input, obstacles: [], traces: [trace] })
      copper.set(trace, stored)
    }
    return stored
  }
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  for (const previous of traces) {
    const name = previous.connection_name!
    const others = result.filter((trace) => trace.connection_name !== name)
    if (
      !others.some((trace) =>
        conflicts.firstConflict(
          physical(previous),
          physical(trace),
          clearance - 1e-8,
        ),
      )
    )
      continue
    const vias = previous.route.flatMap((point, index) =>
      point.route_type === "via" ? [index] : [],
    )
    if (vias.length !== 2) continue
    const [firstVia, lastVia] = vias
    const route = previous.route.slice(firstVia + 1, lastVia)
    const first = route[0]
    const last = route.at(-1)
    if (
      !first ||
      !last ||
      first.route_type !== "wire" ||
      last.route_type !== "wire" ||
      first.layer !== last.layer
    )
      continue
    const connection = input.connections.find((c) => c.name === name)!
    const escapes: Trace[] = [
      {
        ...previous,
        pcb_trace_id: `refine_escape_${name}_0`,
        curvedSegments: undefined,
        coupledSection: undefined,
        route: previous.route.slice(0, firstVia + 2),
      },
      {
        ...previous,
        pcb_trace_id: `refine_escape_${name}_1`,
        curvedSegments: undefined,
        coupledSection: undefined,
        route: previous.route
          .slice(lastVia - 1)
          .toReversed()
          .map((point) =>
            point.route_type === "via"
              ? {
                  ...point,
                  from_layer: point.to_layer,
                  to_layer: point.from_layer,
                }
              : point,
          ),
      },
    ]
    const local: SimpleRouteJson = {
      ...input,
      allowedLayers: [first.layer],
      connections: [{ ...connection, pointsToConnect: [first, last] }],
      traces: [...(input.traces ?? []), ...paired, ...others, ...escapes],
      differentialPairs: [],
      buses: [
        {
          busId: `refine_${name}`,
          connectionNames: [name],
          minLength: minimums.get(name),
          maxLength: maximums.get(name),
        },
      ],
    }
    const solver = new BusLanesSolver(local, {
      smoothTuning: true,
      denseSearch: true,
      maxSearchIterations: 500000,
      originalCorridorTuningCandidates: 65536,
    })
    while (!solver.solved && !solver.failed) {
      solver.step()
      yield
    }
    if (!solver.solved) continue
    const replacement = joinSignalEscapes(solver.traces[0], escapes)
    result = result.map((trace) =>
      trace.connection_name === name ? replacement : trace,
    )
    yield
  }
  return result
}
