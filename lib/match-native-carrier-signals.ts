import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { toNativeValidationSrj } from "./native-validation-input"
import { CopperConflictIndex } from "./copper-conflict-index"
import { length, segmentDistance } from "./geometry"
import { GridHistoryProjector } from "./grid-visibility"
import {
  nativeCarrierLayers,
  type NativeCarrierLayerOptions,
} from "./native-carrier-layers"
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
import { refineNativeCarrierSignals } from "./refine-native-carrier-signals"
import { fixedCopper, VectorScene } from "./vector-scene"
import type { Connection, SimpleRouteJson, Trace } from "./types"

export interface NativeCarrierMatchingOptions
  extends NativeCarrierLayerOptions {
  /** Genuine native owners of immutable copper, excluded from routing requests. */
  fixedConnections?: Connection[]
  gridStep?: number
  fineGridStep?: number
  maxPasses?: number
  maxLocalPasses?: number
  maxExpansionsPerRoute?: number
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
  const layerSelection = nativeCarrierLayers({ input: original, options })
  const pairedNames = new Set(paired.map((t) => t.connection_name))
  const input: SimpleRouteJson = {
    ...original,
    allowedLayers: [layerSelection.primary],
    connections: original.connections.filter((c) => !pairedNames.has(c.name)),
    traces: [...(original.traces ?? []), ...paired],
  }
  const minimums = new Map<string, number>(),
    maximums = new Map<string, number>()
  for (const bus of original.buses ?? []) {
    const anchors = paired.filter((t) =>
      bus.connectionNames.includes(t.connection_name!),
    )
    if (!anchors.length)
      throw Error(
        `Native matching bus ${bus.busId} needs a paired length anchor`,
      )
    const ceiling = Math.min(
      Math.max(...anchors.map((t) => length(t.route))),
      bus.maxLength ?? Infinity,
    )
    const floor = Math.max(
      bus.minLength ?? 0,
      ceiling - (bus.maxLengthSkew ?? 0),
    )
    for (const name of bus.connectionNames) {
      maximums.set(name, Math.min(maximums.get(name) ?? Infinity, ceiling))
      minimums.set(name, Math.max(minimums.get(name) ?? 0, floor))
    }
  }
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
          !nativeSignalGeometryIsValid(t) ||
          (minimums.has(t.connection_name!) &&
            (length(t.route) < minimums.get(t.connection_name!)! - 1e-7 ||
              length(t.route) > maximums.get(t.connection_name!)! + 1e-7)),
      )
      .map((t) => t.connection_name!)
  const valid = (traces: Trace[]) => {
    const complete = [...paired, ...traces]
    if (
      complete.length !== original.connections.length ||
      !complete.every(nativeSignalGeometryIsValid)
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
      inputSrj: toNativeValidationSrj(validationInput),
      routedSrj: toNativeValidationSrj({
        ...validationInput,
        traces: [...(original.traces ?? []), ...complete],
      }),
      clearance,
      allowBlindAndBuriedVias: false,
    }).valid
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
        { bounds: local.bounds, step },
      )
    const topHistory = new Float32Array(projector.cellCount)
    const carrierHistories = new Map(
      layerSelection.ordinary.map(
        (layer) => [layer, new Float32Array(projector.cellCount)] as const,
      ),
    )
    const routers = new Map(
      layerSelection.ordinary.map(
        (layer) =>
          [
            layer,
            new NativeCarrierRouter({
              input: { ...local, allowedLayers: [layer] },
              step,
              history: [topHistory, carrierHistories.get(layer)!],
            }),
          ] as const,
      ),
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
        const old = routed.get(c.name)
        routed.delete(c.name)
        const others = [...routed.values()],
          maximum = maximums.get(c.name) ?? Infinity
        let candidate: Trace | null = null
        const search = {
          softTraces: others,
          softPenalty: 5 + pass * 5,
          maxLength: maximum,
          maxExpansions: options.maxExpansionsPerRoute,
        }
        const layers = layerSelection.ordinary.filter((layer) =>
          (original.buses ?? []).every(
            (bus) =>
              !bus.connectionNames.includes(c.name) ||
              !bus.allowedLayers ||
              bus.allowedLayers.includes(layer),
          ),
        )
        if (pass >= 1) {
          for (const layer of layers) {
            const strict = yield* routers.get(layer)!.route(c, {
              ...search,
              strict: true,
              maxExpansions: Math.min(
                options.maxStrictExpansionsPerRoute ?? 300000,
                options.maxExpansionsPerRoute ?? 1500000,
              ),
            })
            if (!strict) continue
            const hard = {
              ...local,
              allowedLayers: [layer],
              traces: [...local.traces!, ...others],
            }
            const trace = minimums.has(c.name)
              ? tuneNativeCarrierSignal(
                  hard,
                  c,
                  strict.trace,
                  minimums.get(c.name)!,
                  maximum,
                  [],
                )
              : cleanNativeCarrierSignal(hard, c, strict.trace, [], true)
            if (
              trace &&
              others.every(
                (other) =>
                  !index.firstConflict(
                    physical(trace),
                    physical(other),
                    clearance - 1e-8,
                  ),
              )
            ) {
              candidate = trace
              break
            }
          }
        }
        let provisional: Trace | null = null
        let fewestConflicts = Infinity
        if (!candidate) {
          for (const layer of layers) {
            const raw = yield* routers.get(layer)!.route(c, search)
            if (!raw) continue
            const carrierInput = { ...local, allowedLayers: [layer] }
            const matched = minimums.has(c.name)
              ? tuneNativeCarrierSignal(
                  carrierInput,
                  c,
                  raw.trace,
                  minimums.get(c.name)!,
                  maximum,
                  others,
                  raw.bankCost,
                )
              : cleanNativeCarrierSignal(
                  carrierInput,
                  c,
                  raw.trace,
                  others,
                  true,
                )
            if (matched) {
              const collisions =
                layers.length === 1
                  ? 0
                  : others.filter((other) =>
                      index.firstConflict(
                        physical(matched),
                        physical(other),
                        clearance - 1e-8,
                      ),
                    ).length
              if (collisions < fewestConflicts) {
                candidate = matched
                fewestConflicts = collisions
              }
              // Keep the established first clear choice. A matched but
              // colliding primary must not hide a clear permitted alternative.
              if (!collisions) break
              continue
            }
            // Charge an untunable path on its actual carrier. A different layer
            // is also tried before retaining a provisional unmatched signal.
            if (length(raw.trace.route) < (minimums.get(c.name) ?? 0) - 1e-8) {
              for (const wire of physical(raw.trace)) {
                if (wire.layer !== layer) continue
                projector.penalizeIntersection(
                  carrierHistories.get(layer)!,
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
            provisional ??= raw.trace
          }
          if (!candidate && !old) candidate = provisional
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
        const history =
          first.layer === "top" ? topHistory : carrierHistories.get(first.layer)
        if (history)
          projector.penalizeIntersection(
            history,
            first.a,
            first.b,
            second.a,
            second.b,
            first.radius + second.radius + clearance,
            true,
            10,
          )
      }
      const missing = unfinished(all)
      for (const name of missing)
        trouble.set(name, (trouble.get(name) ?? 0) + 1)
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
      if (!hits.length && !missing.length) return state
      if (stale >= 5 && best && metric > bestMetric) {
        routed.clear()
        for (const t of best.traces)
          if (!frozenNames.has(t.connection_name))
            routed.set(t.connection_name!, t)
        trouble = new Map([...routed.keys()].map((n) => [n, 1]))
        stale = 0
      }
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
  const firstState = yield* negotiate(
    initial,
    [],
    options.gridStep ?? original.minTraceWidth,
    options.maxPasses ?? 48,
    "native_global_matching",
  )
  if (!firstState) return null
  let state: State = firstState
  if (!state.collisions && !state.unfinished.length && valid(state.traces))
    return [...paired, ...state.traces]
  for (let repair = 0; repair < 6; repair++) {
    const refined = yield* refineNativeCarrierSignals({
      input: original,
      paired,
      traces: state.traces,
      minimums,
      maximums,
    })
    state = {
      traces: refined,
      collisions: graph(refined).length,
      unfinished: unfinished(refined),
    }
    progress?.({
      ...state,
      stage: "native_fixed_via_repair",
      pass: repair,
      traces: [...paired, ...state.traces],
    })
    if (!state.collisions && !state.unfinished.length && valid(state.traces))
      return [...paired, ...state.traces]
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
              layerSelection.ordinary.includes(w.layer) &&
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
