import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { CopperConflictIndex } from "./copper-conflict-index"
import { nativeLengthWindows } from "./native-length-windows"
import { length, segmentDistance } from "./geometry"
import { GridHistoryProjector } from "./grid-visibility"
import { NativeCarrierRouter } from "./native-carrier-router"
import {
  cleanNativeCarrierSignal,
  tuneNativeCarrierSignal,
} from "./native-carrier-tuning"
import { busLengthReports, pairLengthReports } from "./route-lengths"
import { pairCouplingReports } from "./pair-coupling"
import { exteriorPairSpacingReports } from "./exterior-pair-spacing"
import { sharedPairSpacingReports } from "./shared-pair-spacing"
import { nativeSignalGeometryIsValid } from "./native-signal-geometry"
import { joinedSignalGeometryIsValid } from "./joined-signal-geometry"
import { fixedCopper, VectorScene } from "./vector-scene"
import type { Connection, SimpleRouteJson, Trace } from "./types"

export interface NativeCarrierMatchingOptions {
  /** New pinned cohorts use self-clearance history and retain existing tuning
   * banks during repair. Existing strategies preserve their search ordering;
   * final acceptance always checks joined geometry in both modes. */
  adaptiveRepair?: boolean
  /** Preserve a freshly cleared topology while adding its timing banks. */
  preserveExistingRoutes?: boolean
  /** Genuine native owners of immutable copper, excluded from routing requests. */
  fixedConnections?: Connection[]
  /** Initial timing targets for buses without a differential length anchor. */
  busTargetLengths?: Record<string, number>
  /** Explore shortest/congestion paths first; finished copper must still meet
   * the same maximum lengths and skew windows. */
  deferSearchLengthBound?: boolean
  routingBounds?: SimpleRouteJson["bounds"]
  gridStep?: number
  fineGridStep?: number
  maxPasses?: number
  maxLocalPasses?: number
  maxExpansionsPerRoute?: number
  maxTuningCandidates?: number
  /** Bound speculative hard-only repairs; soft negotiation retains its full budget. */
  maxStrictExpansionsPerRoute?: number
}
export interface NativeCarrierProgress {
  groupName?: string
  completedConnections?: number
  stage: string
  pass: number
  collisions: number
  unfinished: string[]
  traces: Trace[]
}
interface State {
  traces: Trace[]
  collisions: number
  unfinished: string[]
}

/** Matched carriers and controllers negotiate together. A clear but unmatched
 * state is never accepted; matching banks participate in the physical conflict
 * graph alongside TOP escapes and all four plated via lands. */
export function* matchNativeCarrierSignals(
  original: SimpleRouteJson,
  paired: Trace[],
  options: NativeCarrierMatchingOptions = {},
  progress?: (state: NativeCarrierProgress) => void,
  initial: Trace[] = [],
): Generator<void, Trace[] | null> {
  const pairedNames = new Set(paired.map((t) => t.connection_name))
  const input: SimpleRouteJson = {
    ...original,
    connections: original.connections.filter((c) => !pairedNames.has(c.name)),
    traces: [...(original.traces ?? []), ...paired],
  }
  const windows = nativeLengthWindows(
    original,
    paired,
    options.busTargetLengths,
  )
  const { minimums, maximums } = windows
  const clearance =
    original.minTraceToPadEdgeClearance ??
    original.defaultObstacleMargin ??
    0.075
  const index = new CopperConflictIndex()
  // Negotiation replaces traces rather than mutating them. Keep each trace's
  // immutable copper identity so unchanged pairs can reuse conflict answers.
  const physicalCache = new WeakMap<Trace, ReturnType<typeof fixedCopper>>()
  const physical = (t: Trace) => {
    let copper = physicalCache.get(t)
    if (!copper) {
      copper = fixedCopper({ ...original, obstacles: [], traces: [t] })
      physicalCache.set(t, copper)
    }
    return copper
  }
  const geometryCache = new WeakMap<Trace, boolean>()
  const geometryValid = (trace: Trace) => {
    let valid = geometryCache.get(trace)
    if (valid === undefined) {
      valid = joinedSignalGeometryIsValid({ input: original, trace })
      geometryCache.set(trace, valid)
    }
    return valid
  }
  const graph = (traces: Trace[]) => {
    const copper = traces.map(physical),
      hits: Array<
        [
          number,
          number,
          NonNullable<ReturnType<CopperConflictIndex["firstConflict"]>>,
        ]
      > = []
    for (let a = 0; a < traces.length; a++)
      for (let b = 0; b < a; b++) {
        const hit = index.firstConflict(copper[a], copper[b], clearance - 1e-8)
        if (hit) hits.push([a, b, hit])
      }
    return hits
  }
  const unfinished = (traces: Trace[]) =>
    traces
      .filter(
        (t) =>
          !(options.adaptiveRepair
            ? geometryValid(t)
            : nativeSignalGeometryIsValid(t)) ||
          (minimums.has(t.connection_name!) &&
            (length(t.route) < minimums.get(t.connection_name!)! - 1e-7 ||
              length(t.route) > maximums.get(t.connection_name!)! + 1e-7)),
      )
      .map((t) => t.connection_name!)
  const valid = (traces: Trace[]) => {
    const complete = [...paired, ...traces]
    if (
      complete.length !== original.connections.length ||
      !complete.every(geometryValid)
    )
      return false
    if (
      busLengthReports(original, complete).some(
        (b) =>
          !b.aboveMinimumLength ||
          !b.withinLengthLimit ||
          (b.toleranceMm !== null && !b.matched),
      )
    )
      return false
    if (pairLengthReports(original, complete).some((p) => !p.matched))
      return false
    if (
      sharedPairSpacingReports(original, complete).some((p) => !p.matched) ||
      exteriorPairSpacingReports(original, complete).some((p) => !p.matched)
    )
      return false
    if (pairCouplingReports(original, complete).some((p) => !p.matched))
      return false
    const validationInput = {
      ...original,
      connections: [
        ...original.connections,
        ...(options.fixedConnections ?? []),
      ],
    }
    return validateRoutedCopperDrc({
      inputSrj: validationInput,
      routedSrj: {
        ...validationInput,
        traces: [...(original.traces ?? []), ...complete],
      },
      clearance,
      allowBlindAndBuriedVias: false,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid
  }
  if (!input.connections.length) return valid([]) ? paired : null
  function* negotiate(
    seed: Trace[],
    frozen: Trace[],
    step: number,
    passes: number,
    stage: string,
  ): Generator<void, State | null> {
    const frozenNames = new Set(frozen.map((t) => t.connection_name))
    const local = {
      ...input,
      connections: input.connections.filter((c) => !frozenNames.has(c.name)),
      traces: [...input.traces!, ...frozen],
    }
    if (!local.connections.length)
      return { traces: frozen, collisions: 0, unfinished: unfinished(frozen) }
    const fixed = fixedCopper(local),
      projector = new GridHistoryProjector(
        new VectorScene(
          local,
          local.connections[0],
          local.minTraceWidth,
          fixed,
        ),
        { bounds: options.routingBounds ?? local.bounds, step },
      )
    const history = [
        new Float32Array(projector.cellCount),
        new Float32Array(projector.cellCount),
      ],
      router = new NativeCarrierRouter(
        local,
        step,
        history,
        options.routingBounds,
      )
    const routed = new Map(
      seed
        .filter((t) => !frozenNames.has(t.connection_name))
        .map((t) => [t.connection_name!, t]),
    )
    let trouble = new Map<string, number>(),
      best: State | null = null,
      bestMetric = Infinity,
      stale = 0
    for (let pass = 0; pass < passes; pass++) {
      for (const c of [...local.connections].sort(
        (a, b) => (trouble.get(b.name) ?? 0) - (trouble.get(a.name) ?? 0),
      )) {
        if (pass >= 2 && !trouble.has(c.name)) continue
        progress?.({
          stage: `${stage}_route`,
          pass,
          collisions: 0,
          unfinished: [c.name],
          traces: [...paired, ...frozen, ...routed.values()],
        })
        const old = routed.get(c.name)
        routed.delete(c.name)
        const others = [...routed.values()]
        let maximum = maximums.get(c.name) ?? Infinity
        let candidate: Trace | null = null
        const clearsOthers = (trace: Trace) =>
          others.every(
            (other) =>
              !index.firstConflict(
                physical(trace),
                physical(other),
                clearance - 1e-8,
              ),
          )
        if (
          options.preserveExistingRoutes &&
          old &&
          joinedSignalGeometryIsValid({ input: original, trace: old }) &&
          clearsOthers(old)
        ) {
          const measured = length(old.route)
          if (
            measured >= (minimums.get(c.name) ?? 0) - 1e-7 &&
            measured <= maximum + 1e-7
          )
            candidate = old
          else if (measured < (minimums.get(c.name) ?? 0)) {
            const extended = tuneNativeCarrierSignal(
              { ...local, traces: [...local.traces!, ...others] },
              c,
              old,
              minimums.get(c.name)!,
              maximum,
              [],
              undefined,
              options.maxTuningCandidates,
              true,
            )
            if (extended && clearsOthers(extended)) candidate = extended
          }
        }
        const search = {
          softTraces: others,
          softPenalty: 5 + pass * 5,
          maxLength: options.deferSearchLengthBound ? undefined : maximum,
          maxExpansions: options.maxExpansionsPerRoute,
        }
        if (!candidate && pass >= 1) {
          const strict = yield* router.route(c, {
            ...search,
            strict: true,
            maxExpansions: Math.min(
              options.maxStrictExpansionsPerRoute ?? 300000,
              options.maxExpansionsPerRoute ?? 1500000,
            ),
          })
          if (strict) {
            const hard = { ...local, traces: [...local.traces!, ...others] }
            const t = minimums.has(c.name)
              ? tuneNativeCarrierSignal(
                  hard,
                  c,
                  strict.trace,
                  minimums.get(c.name)!,
                  maximum,
                  [],
                  undefined,
                  options.maxTuningCandidates,
                )
              : cleanNativeCarrierSignal(hard, c, strict.trace, [], true)
            if (
              t &&
              others.every(
                (other) =>
                  !index.firstConflict(
                    physical(t),
                    physical(other),
                    clearance - 1e-8,
                  ),
              )
            )
              candidate = t
          }
        }
        if (!candidate) {
          let raw = yield* router.route(c, search)
          // A congestion-cheap detour is not evidence that the whole bus must
          // become longer. Preserve its timing window when a more expensive,
          // length-bounded alternative is available.
          if (
            raw &&
            options.deferSearchLengthBound &&
            Number.isFinite(maximum) &&
            length(raw.trace.route) > maximum + 1e-7
          ) {
            const bounded = yield* router.route(c, {
              ...search,
              maxLength: maximum,
            })
            if (bounded) raw = bounded
          }
          if (raw) {
            if (options.deferSearchLengthBound) {
              const clean = cleanNativeCarrierSignal(
                local,
                c,
                raw.trace,
                others,
                true,
              )
              if (clean && windows.grow(c.name, length(clean.route))) {
                best = null
                bestMetric = Infinity
                stale = 0
              }
              maximum = maximums.get(c.name) ?? Infinity
            }
            candidate = minimums.has(c.name)
              ? tuneNativeCarrierSignal(
                  local,
                  c,
                  raw.trace,
                  minimums.get(c.name)!,
                  maximum,
                  others,
                  raw.bankCost,
                  options.maxTuningCandidates,
                )
              : cleanNativeCarrierSignal(local, c, raw.trace, others, true)
            if (
              options.adaptiveRepair &&
              !candidate &&
              old &&
              minimums.has(c.name) &&
              length(old.route) < minimums.get(c.name)! - 1e-8 &&
              geometryValid(old)
            )
              candidate = tuneNativeCarrierSignal(
                local,
                c,
                old,
                minimums.get(c.name)!,
                maximum,
                others,
                raw.bankCost,
                options.maxTuningCandidates,
                true,
              )
            // A hard-clear shortest path can have no room for its timing bank.
            // Retrying it unchanged cannot improve the state: charge its carrier
            // corridor so the next search explores a different tunable topology.
            if (
              !candidate &&
              length(raw.trace.route) < (minimums.get(c.name) ?? 0) - 1e-8
            ) {
              for (const wire of physical(raw.trace)) {
                if (wire.layer !== input.allowedLayers![0]) continue
                projector.penalizeIntersection(
                  history[1],
                  wire.a,
                  wire.b,
                  wire.a,
                  wire.b,
                  wire.radius + clearance,
                  true,
                  2,
                )
              }
            }
            // An honest provisional path supplies connectivity for later
            // repairs when its first bank cannot fit. It is still unfinished.
            if (!candidate && !old) candidate = raw.trace
          }
        }
        if (candidate) routed.set(c.name, candidate)
        else if (old) routed.set(c.name, old)
        else return null
        yield
      }
      const all = [...routed.values()],
        hits = graph(all)
      trouble = new Map()
      for (const [a, b, [first, second]] of hits) {
        for (const t of [all[a], all[b]])
          trouble.set(
            t.connection_name!,
            (trouble.get(t.connection_name!) ?? 0) + 1,
          )
        const plane = first.layer === input.allowedLayers![0] ? 1 : 0
        if (first.layer === "top" || plane === 1)
          projector.penalizeIntersection(
            history[plane],
            first.a,
            first.b,
            second.a,
            second.b,
            first.radius + second.radius + clearance,
            true,
            10,
          )
      }
      const missing = unfinished(
        options.adaptiveRepair ? [...frozen, ...all] : all,
      )
      for (const name of missing)
        trouble.set(name, (trouble.get(name) ?? 0) + 1)
      // An isolated returning arm has no different-net conflict to charge.
      // Without feedback the shortest-path search repeats that same invalid
      // geometry forever, even though it is correctly marked unfinished.
      for (const trace of options.adaptiveRepair ? all : []) {
        if (geometryValid(trace)) continue
        for (const wire of physical(trace)) {
          const plane = wire.layer === input.allowedLayers![0] ? 1 : 0
          if (wire.layer !== "top" && plane !== 1) continue
          projector.penalizeIntersection(
            history[plane],
            wire.a,
            wire.b,
            wire.a,
            wire.b,
            wire.radius + clearance,
            true,
            2,
          )
        }
      }
      const state = {
          traces: [...frozen, ...all],
          collisions: hits.length,
          unfinished: missing,
        },
        metric = hits.length + 20 * missing.length
      progress?.({
        ...state,
        stage,
        pass,
        traces: [...paired, ...state.traces],
      })
      if (metric < bestMetric) {
        bestMetric = metric
        best = structuredClone(state)
        stale = 0
      } else stale++
      // A grown unanchored timing window can invalidate frozen bus members.
      // Return immediately so the next repair closure can unfreeze them.
      if (missing.some((name) => frozenNames.has(name))) return state
      if (!hits.length && !missing.length) return state
      if (stale >= 5 && best && metric > bestMetric) {
        routed.clear()
        for (const t of best.traces)
          if (!frozenNames.has(t.connection_name))
            routed.set(t.connection_name!, t)
        trouble = new Map([...routed.keys()].map((n) => [n, 1]))
        stale = 0
      }
      // Expand a stalled repair closure instead of repeatedly searching with
      // the same neighboring banks frozen in place.
      if (options.preserveExistingRoutes && frozen.length && stale >= 2) break
      if (
        stage === "native_global_matching" &&
        best &&
        !best.unfinished.length &&
        best.collisions <= 6 &&
        stale >= 2
      )
        break
      yield
    }
    return best
  }
  let firstState: State | null = null
  if (
    options.preserveExistingRoutes &&
    initial.length === input.connections.length &&
    new Set(initial.map((trace) => trace.connection_name)).size ===
      initial.length &&
    input.connections.every((c) =>
      initial.some((trace) => trace.connection_name === c.name),
    ) &&
    initial.every((trace) =>
      joinedSignalGeometryIsValid({ input: original, trace }),
    ) &&
    graph(initial).length === 0
  ) {
    const prepared = new Map(
      initial.map((trace) => [trace.connection_name!, trace]),
    )
    const deficit = (name: string) =>
      (minimums.get(name) ?? 0) - length(prepared.get(name)!.route)
    for (const c of [...input.connections].sort(
      (a, b) => deficit(b.name) - deficit(a.name),
    )) {
      const old = prepared.get(c.name)!
      if (!minimums.has(c.name) || deficit(c.name) <= 1e-7) continue
      const others = [...prepared.values()].filter((trace) => trace !== old)
      const tuned = tuneNativeCarrierSignal(
        { ...input, traces: [...input.traces!, ...others] },
        c,
        old,
        minimums.get(c.name)!,
        maximums.get(c.name)!,
        [],
        undefined,
        options.maxTuningCandidates,
        true,
      )
      if (
        tuned &&
        joinedSignalGeometryIsValid({ input: original, trace: tuned }) &&
        others.every(
          (other) =>
            !index.firstConflict(
              physical(tuned),
              physical(other),
              clearance - 1e-8,
            ),
        )
      )
        prepared.set(c.name, tuned)
      yield
    }
    const traces = [...prepared.values()]
    firstState = { traces, collisions: 0, unfinished: unfinished(traces) }
    progress?.({
      ...firstState,
      traces: [...paired, ...traces],
      stage: "native_clear_topology_tuning",
      pass: 0,
    })
  } else {
    firstState = yield* negotiate(
      initial,
      [],
      options.gridStep ?? original.minTraceWidth,
      options.maxPasses ?? 48,
      "native_global_matching",
    )
  }
  if (!firstState) return null
  let state: State = firstState
  if (!state.collisions && !state.unfinished.length && valid(state.traces))
    return [...paired, ...state.traces]
  for (let repair = 0; repair < 6; repair++) {
    const closure = new Set<string>(),
      hits = graph(state.traces)
    for (const [a, b] of hits) {
      closure.add(state.traces[a].connection_name!)
      closure.add(state.traces[b].connection_name!)
    }
    for (const name of state.unfinished) closure.add(name)
    if (repair > 0) {
      const mouths = input.connections
        .filter((c) => closure.has(c.name))
        .flatMap((c) => c.pointsToConnect)
      const crossings = hits.map(([, , [a, b]]) => ({
        x: (a.a.x + a.b.x + b.a.x + b.b.x) / 4,
        y: (a.a.y + a.b.y + b.a.y + b.b.y) / 4,
      }))
      for (const t of state.traces) {
        if (closure.has(t.connection_name!)) continue
        if (
          physical(t).some(
            (w) =>
              w.layer === input.allowedLayers![0] &&
              (mouths.some(
                (p) =>
                  segmentDistance([p, p], [w.a, w.b]) < w.radius + 0.5 * repair,
              ) ||
                crossings.some(
                  (p) =>
                    segmentDistance([p, p], [w.a, w.b]) <
                    w.radius + 0.4 * (repair - 1),
                )),
          )
        )
          closure.add(t.connection_name!)
      }
    }
    const frozen = state.traces.filter((t) => !closure.has(t.connection_name!))
    const next: State | null = yield* negotiate(
      state.traces,
      frozen,
      options.fineGridStep ?? original.minTraceWidth / 2,
      options.maxLocalPasses ?? 48,
      `native_local_matching_${repair}`,
    )
    // Compare both states against the current windows, including any growth
    // during this repair. A cached earlier deficit count is no longer valid.
    state.unfinished = unfinished(state.traces)
    if (
      next &&
      next.collisions + 20 * next.unfinished.length <=
        state.collisions + 20 * state.unfinished.length
    )
      state = next
    if (!state.collisions && !state.unfinished.length && valid(state.traces))
      return [...paired, ...state.traces]
  }
  return null
}
