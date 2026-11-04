import cpuPads from "./data/mt8395-pads.json"
import memoryPads from "./data/micron-pads.json"
import { Fragment, type ReactElement } from "react"

// Routing research fixture. Geometry/skew rules are experimental, not vendor sign-off.
export const rules = {
  width: 0.06,
  clearance: 0.06,
  cpuPad: 0.2,
  memoryPad: 0.4,
  viaPad: 0.2,
  viaDrill: 0.1,
  byteSkew: 0.5,
  commandSkew: 0.5,
  pairSkew: 0.1,
  pairGap: 0.08,
}
export const parts = [
  {
    name: "U1",
    mpn: "MT8395AV/ZA",
    x: 0,
    y: 0,
    rotation: 0,
    width: 15,
    height: 15,
    diameter: rules.cpuPad,
    pads: cpuPads,
  },
  {
    name: "U2",
    mpn: "MT53E1G32D2FW-046 WT:B",
    x: 0,
    y: 21,
    rotation: 90,
    width: 10,
    height: 14.5,
    diameter: rules.memoryPad,
    pads: memoryPads,
  },
  {
    name: "U3",
    mpn: "MT53E1G32D2FW-046 WT:B",
    x: -21,
    y: 0,
    rotation: 0,
    width: 10,
    height: 14.5,
    diameter: rules.memoryPad,
    pads: memoryPads,
  },
]
export const links: {
  name: string
  from: string
  to: string
  channel: number
  group: string
}[] = []
for (let ch = 0; ch < 4; ch++) {
  const device = ch < 2 ? "U2" : "U3"
  const memChannel = ch === 0 ? "B" : ch === 1 ? "A" : ch === 2 ? "A" : "B"
  const signals = [
    ...Array.from({ length: 16 }, (_, i) => `DQ${i}`),
    "DMI0",
    "DMI1",
    "DQS0_T",
    "DQS0_C",
    "DQS1_T",
    "DQS1_C",
    ...Array.from({ length: 6 }, (_, i) => `CA${i}`),
    "CK_T",
    "CK_C",
    "CS0",
    "CS1",
    "CKE0",
    "CKE1",
  ]
  for (const signal of signals) {
    const name = `EMI${ch}_${signal}`
    const cp = cpuPads.find((p) => p.signal === name)
    const target =
      signal.replace(/_T$/, "_t").replace(/_C$/, "_c") + "_" + memChannel
    const mp = memoryPads.find((p) => p.signal === target)
    if (!cp || !mp) throw Error(`Pin mapping missing ${name} / ${target}`)
    const group = /^DQ\d+$/.test(signal)
      ? `BYTE${Number(signal.slice(2)) < 8 ? 0 : 1}`
      : /^DMI|^DQS/.test(signal)
        ? `BYTE${signal[3]}`
        : /^CK_/.test(signal)
          ? "CLOCK"
          : "COMMAND"
    links.push({
      name,
      from: `U1.${cp.ball}`,
      to: `${device}.${mp.ball}`,
      channel: ch,
      group,
    })
  }
}
// Each dual-channel package has one RESET_n; one controller reset drives each package.
for (const [ch, device] of [
  [0, "U2"],
  [2, "U3"],
] as const) {
  const cp = cpuPads.find((p) => p.signal === `EMI${ch}_RESET_N`)!
  const mp = memoryPads.find((p) => p.signal === "RESET_n")!
  links.push({
    name: `EMI${ch}_RESET_N`,
    from: `U1.${cp.ball}`,
    to: `${device}.${mp.ball}`,
    channel: ch,
    group: "RESET",
  })
}
export const groups = Array.from(
  new Set(links.map((l) => `EMI${l.channel}_${l.group}`)),
).map((name) => ({
  name,
  links: links.filter((l) => `EMI${l.channel}_${l.group}` === name),
  layer: name.endsWith("BYTE0")
    ? ("inner2" as const)
    : name.endsWith("BYTE1")
      ? ("inner4" as const)
      : ("inner6" as const),
}))
export function selectLinks(scope: string) {
  if (scope === "full") return links
  if (scope === "channel1") return links.filter((l) => l.channel === 1)
  if (scope === "byte1")
    return links.filter((l) => l.channel === 1 && l.group === "BYTE1")
  if (scope === "pair")
    return links.filter((l) => /EMI1_DQS0_[TC]/.test(l.name))
  return links.filter((l) => l.channel === 1 && l.group === "BYTE0")
}
function Package({ part }: { part: (typeof parts)[number] }) {
  const a = (part.rotation * Math.PI) / 180
  return (
    <chip
      name={part.name}
      manufacturerPartNumber={part.mpn}
      pcbX={part.x}
      pcbY={part.y}
      noSchematicRepresentation
      pinLabels={Object.fromEntries(
        part.pads.map((p, i) => [
          `pin${i + 1}`,
          [p.ball, p.signal + "_" + p.ball],
        ]),
      )}
      footprint={
        <footprint>
          {part.pads.map((p, i) => (
            <Fragment key={p.ball}>
              <smtpad
                shape="circle"
                radius={part.diameter / 2}
                pcbX={p.x * Math.cos(a) - p.y * Math.sin(a)}
                pcbY={p.x * Math.sin(a) + p.y * Math.cos(a)}
                portHints={[`pin${i + 1}`, p.ball]}
              />
            </Fragment>
          ))}
          <silkscreenrect
            pcbX={0}
            pcbY={0}
            width={part.rotation ? part.height : part.width}
            height={part.rotation ? part.width : part.height}
            strokeWidth={0.12}
          />
          <silkscreentext
            text={`${part.name} ${part.mpn}`}
            pcbY={-(part.rotation ? part.width : part.height) / 2 - 1}
            fontSize={0.65}
          />
        </footprint>
      }
    />
  )
}
export default function Board({
  scope = "full",
  routingDisabled = false,
  algorithmFn,
}: {
  scope?: string
  routingDisabled?: boolean
  algorithmFn?: any
} = {}): ReactElement {
  const selected = selectLinks(scope),
    names = new Set(selected.map((l) => l.name))
  return (
    <board
      title="MT8395 LPDDR4X routing research prototype"
      width={60}
      height={60}
      pcbX={-5}
      pcbY={5}
      layers={8}
      schematicDisabled
      routeRemaining={false}
      routingDisabled={routingDisabled}
      minTraceWidth={rules.width}
      defaultTraceWidth={rules.width}
      minTraceToPadEdgeClearance={rules.clearance}
      minViaEdgeToPadEdgeClearance={rules.clearance}
      minPadEdgeToPadEdgeClearance={rules.clearance}
      minTraceToHoleEdgeClearance={rules.clearance}
      minViaPadDiameter={rules.viaPad}
      minViaHoleDiameter={rules.viaDrill}
      isViaInPadAllowed={false}
    >
      {parts.map((part) => (
        <Package key={part.name} part={part} />
      ))}
      <autoroutingphase
        name="LPDDR4X_BUS_LANES"
        phaseIndex={0}
        autorouter="bus_lanes"
        {...(algorithmFn ? { algorithmFn } : {})}
      />
      {selected.map((l) => (
        <Fragment key={l.name}>
          <trace
            name={l.name}
            from={l.from}
            to={l.to}
            routingPhaseIndex={0}
            width={rules.width}
          />
        </Fragment>
      ))}
      {groups
        .filter((g) => g.links.some((l) => names.has(l.name)))
        .map((g) => (
          <Fragment key={g.name}>
            <bus
              name={g.name}
              connections={g.links
                .filter((l) => names.has(l.name))
                .map((l) => l.name)}
              routingPhaseIndex={0}
              pcbAllowedLayers={[g.layer]}
              pcbTraceWidth={rules.width}
              {...(!g.name.endsWith("RESET")
                ? {
                    maxLengthSkew: g.name.endsWith("CLOCK")
                      ? rules.pairSkew
                      : rules.byteSkew,
                  }
                : {})}
            />
          </Fragment>
        ))}
      {[0, 1, 2, 3]
        .flatMap((ch) =>
          ["DQS0", "DQS1", "CK"].map((pair) => ({
            p: `EMI${ch}_${pair}_T`,
            n: `EMI${ch}_${pair}_C`,
          })),
        )
        .filter((p) => names.has(p.p) && names.has(p.n))
        .map((p) => (
          <Fragment key={p.p}>
            <differentialpair
              name={p.p + "_PAIR"}
              positiveConnection={p.p}
              negativeConnection={p.n}
              maxLengthSkew={rules.pairSkew}
              pcbTraceGap={rules.pairGap}
            />
          </Fragment>
        ))}
      <silkscreentext
        text="ROUTING RESEARCH ONLY - POWER / SI NOT VALIDATED"
        pcbX={-5}
        pcbY={31}
        fontSize={0.9}
      />
    </board>
  )
}
