import type { ReactElement } from "react"
import { NativePart } from "./native-part"

type DdrSource = {
  id: string
  title: string
  width: number
  height: number
  layers: number
  rules: {
    widths: number[]
    appliedGlobalClearance: number
    viaPad: number
    viaDrill: number
  }
  signalLayers: string[]
  parts: Parameters<typeof NativePart>[0]["part"][]
  traces: {
    name: string
    nativeNet: string
    path: string[]
    width: number
    group: string
  }[]
  requestedNames?: string[]
}

/** Native placements in board-world mm, +X right, +Y up, +Z above.
 * Preserve all pads on the DDR components; route byte groups before remaining nets.
 */
export function NativeDdrBoard({
  source,
  dataOnly = false,
}: {
  source: DdrSource
  dataOnly?: boolean
}): ReactElement {
  const activeTraces = source.requestedNames
    ? source.traces.filter((trace) =>
        source.requestedNames!.includes(trace.name),
      )
    : source.traces
  const activeNames = new Set(activeTraces.map((trace) => trace.name))
  const bytes = [...new Set(activeTraces.map((trace) => trace.group))]
    .filter((group) => group !== "remaining" && group !== "preflight")
    .sort()
  const preflight = activeTraces.some((trace) => trace.group === "preflight")
    ? ["preflight"]
    : []
  const phases = dataOnly ? bytes : [...preflight, ...bytes, "remaining"]
  return (
    <board
      title={source.title}
      width={source.width}
      height={source.height}
      layers={source.layers}
      schematicDisabled
      routeRemaining={false}
      isViaInPadAllowed={false}
      minTraceWidth={Math.min(...source.rules.widths)}
      minTraceToPadEdgeClearance={source.rules.appliedGlobalClearance}
      minViaEdgeToPadEdgeClearance={source.rules.appliedGlobalClearance}
      minViaPadDiameter={source.rules.viaPad}
      minViaHoleDiameter={source.rules.viaDrill}
    >
      {source.parts.map((part) => (
        <NativePart key={part.name} part={part} />
      ))}
      {phases.map((group, phaseIndex) => (
        <autoroutingphase
          key={group}
          name={group}
          phaseIndex={phaseIndex}
          autorouter={bytes.includes(group) ? "bus_lanes" : "auto_local"}
          connections={activeTraces
            .filter((trace) => trace.group === group)
            .map((trace) => trace.name)}
        />
      ))}
      {source.traces.map((trace) => (
        <trace
          key={trace.name}
          name={trace.name}
          path={trace.path}
          thickness={trace.width}
          routingPhaseIndex={
            activeNames.has(trace.name) && phases.includes(trace.group)
              ? phases.indexOf(trace.group)
              : undefined
          }
        />
      ))}
      {bytes.map((group) => (
        <bus
          key={group}
          name={`DDR_BUS_${group}`}
          routingPhaseIndex={phases.indexOf(group)}
          connections={activeTraces
            .filter((trace) => trace.group === group)
            .map((trace) => trace.name)}
          pcbAllowedLayers={source.signalLayers}
        />
      ))}
      <pcbnotetext
        pcbY={source.height / 2 - 0.8}
        fontSize={0.5}
        text={`${source.title}: ${dataOnly ? activeTraces.filter((trace) => trace.group !== "remaining").length : activeTraces.length} DDR nets requested`}
      />
      <pcbnotetext
        pcbY={-source.height / 2 + 0.8}
        fontSize={0.45}
        text="Native geometry; no via-in-pad. Bus bytes, then remaining signals. Timing unqualified."
      />
    </board>
  )
}
