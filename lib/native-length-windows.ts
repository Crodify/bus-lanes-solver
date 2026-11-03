import { length } from "./geometry"
import type { SimpleRouteJson, Trace } from "./types"

/** Paired buses keep their actual copper anchor. Unpaired command buses use
 * measured starting targets which may grow when congestion requires a detour.
 * Every update intersects all owning windows and respects explicit maxLength.
 */
export function nativeLengthWindows(
  input: SimpleRouteJson,
  paired: Trace[],
  targets: Record<string, number> = {},
) {
  const windows = (input.buses ?? []).flatMap((bus) => {
    const anchors = paired.filter((t) =>
      bus.connectionNames.includes(t.connection_name!),
    )
    if (
      !anchors.length &&
      bus.maxLengthSkew === undefined &&
      bus.minLength === undefined &&
      bus.maxLength === undefined
    )
      return []
    if (!anchors.length && targets[bus.busId] === undefined)
      throw Error(
        `Native matching bus ${bus.busId} needs a paired length anchor`,
      )
    const target = anchors.length
      ? Math.max(...anchors.map((t) => length(t.route)))
      : targets[bus.busId]
    if (!Number.isFinite(target) || target < 0)
      throw Error("Native bus timing targets must be finite and nonnegative")
    const ceiling = Math.min(
      anchors.length ? target : Math.max(target, bus.minLength ?? 0),
      bus.maxLength ?? Infinity,
    )
    return [{ bus, anchored: !!anchors.length, ceiling }]
  })
  const minimums = new Map<string, number>(),
    maximums = new Map<string, number>()
  const update = () => {
    minimums.clear()
    maximums.clear()
    for (const { bus, anchored, ceiling } of windows) {
      const floor = Math.max(
        bus.minLength ?? 0,
        bus.maxLengthSkew !== undefined || anchored
          ? ceiling - (bus.maxLengthSkew ?? 0)
          : 0,
      )
      for (const name of bus.connectionNames) {
        maximums.set(name, Math.min(maximums.get(name) ?? Infinity, ceiling))
        minimums.set(name, Math.max(minimums.get(name) ?? 0, floor))
      }
    }
  }
  update()
  return {
    minimums,
    maximums,
    grow(name: string, measured: number) {
      let changed = false
      for (const window of windows) {
        if (
          window.anchored ||
          !window.bus.connectionNames.includes(name) ||
          measured <= window.ceiling + 1e-7
        )
          continue
        const ceiling = Math.min(
          Math.ceil(measured + input.minTraceWidth),
          window.bus.maxLength ?? Infinity,
        )
        if (ceiling > window.ceiling + 1e-7) {
          window.ceiling = ceiling
          changed = true
        }
      }
      if (changed) update()
      return changed
    },
  }
}
