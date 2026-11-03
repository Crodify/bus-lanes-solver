import { readFileSync, writeFileSync } from "node:fs"
import type { SimpleRouteJson } from "../../lib/types"
import { inputHash, loadCase, type CaptureMetadata } from "./input"

import { validateOutput } from "./validate"

const escape = (text: string) =>
  text.replace(
    /[<>&"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
      })[character]!,
  )
const channelColors = ["#f6bc62", "#62d6fa", "#be9aff", "#8cdea2"]
/** SVG Y points down;
 * input coordinates remain board-world millimeters, +X right and +Y up.
 */
function renderSnapshot(
  input: SimpleRouteJson,
  metadata: CaptureMetadata,
  output?: SimpleRouteJson,
): string {
  const signalNames = new Map(
    metadata.signals.map((signal) => [signal.sourceTraceId, signal.name]),
  )
  const isByte0 = (name: string) => /^EMI1_(DQ[0-7]|DMI0|DQS0_[TC])$/.test(name)
  const selected = input.connections.filter((connection) =>
    isByte0(signalNames.get(connection.name) ?? ""),
  )
  const definitions: string[] = []
  const panel = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    bounds: SimpleRouteJson["bounds"],
    connections: SimpleRouteJson["connections"],
  ) => {
    definitions.push(
      `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8"/></clipPath>`,
    )
    const scale = Math.min(
      width / (bounds.maxX - bounds.minX),
      height / (bounds.maxY - bounds.minY),
    )
    const sx = (value: number) =>
      (
        x +
        width / 2 +
        (value - (bounds.minX + bounds.maxX) / 2) * scale
      ).toFixed(3)
    const sy = (value: number) =>
      (
        y +
        height / 2 -
        (value - (bounds.minY + bounds.maxY) / 2) * scale
      ).toFixed(3)
    const s = [
      `<g clip-path="url(#${id})"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#101e30"/>`,
    ]
    for (const [componentId, name, label] of [
      ["pcb_component_0", "U1", "MT8395AV/ZA"],
      ["pcb_component_1", "U2", "LPDDR4X"],
      ["pcb_component_2", "U3", "LPDDR4X"],
    ]) {
      const pads = input.obstacles.filter(
        (pad) => pad.componentId === componentId,
      )
      const minX =
        Math.min(...pads.map((pad) => pad.center.x - pad.width / 2)) - 0.3
      const maxX =
        Math.max(...pads.map((pad) => pad.center.x + pad.width / 2)) + 0.3
      const minY =
        Math.min(...pads.map((pad) => pad.center.y - pad.height / 2)) - 0.3
      const maxY =
        Math.max(...pads.map((pad) => pad.center.y + pad.height / 2)) + 0.3
      s.push(
        `<rect x="${sx(minX)}" y="${sy(maxY)}" width="${((maxX - minX) * scale).toFixed(3)}" height="${((maxY - minY) * scale).toFixed(3)}" fill="#182c41" stroke="#62758b"/>`,
      )
      if (id === "overview")
        s.push(
          `<text x="${sx((minX + maxX) / 2)}" y="${Number(sy(minY)) + 18}" text-anchor="middle" fill="#e1e8f0" font-size="13">${name} · ${label}</text>`,
        )
    }
    for (const pad of input.obstacles) {
      if (pad.shape !== "circle")
        throw Error("MT8395 snapshot expects circular pads")
      s.push(
        `<circle cx="${sx(pad.center.x)}" cy="${sy(pad.center.y)}" r="${((pad.width * scale) / 2).toFixed(3)}" fill="#6d8094"/>`,
      )
    }
    if (output) {
      const names = new Set(connections.map((c) => c.name))
      const colors: Record<string, string> = {
        top: "#ecf0f6",
        inner2: "#62d6fa",
        inner4: "#be9aff",
        inner6: "#f6bc62",
      }
      for (const layer of ["inner6", "inner4", "inner2", "top"]) {
        for (const trace of output.traces ?? []) {
          if (!names.has(trace.connection_name!)) continue
          let run: Array<{ x: number; y: number }> = []
          const flush = () => {
            if (run.length > 1)
              s.push(
                `<path d="${run.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(" ")}" fill="none" stroke="${colors[layer]}" stroke-width="${(input.minTraceWidth * scale).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"><title>${escape(signalNames.get(trace.connection_name!) ?? trace.connection_name!)} · ${layer}</title></path>`,
              )
            run = []
          }
          for (const point of trace.route) {
            if (point.route_type === "wire" && point.layer === layer)
              run.push(point)
            else flush()
          }
          flush()
        }
      }
      for (const trace of output.traces ?? [])
        if (names.has(trace.connection_name!))
          for (const point of trace.route)
            if (point.route_type === "via") {
              s.push(
                `<circle cx="${sx(point.x)}" cy="${sy(point.y)}" r="${(((point.via_diameter ?? input.minViaPadDiameter ?? 0.2) * scale) / 2).toFixed(3)}" fill="#b9c9dc"/><circle cx="${sx(point.x)}" cy="${sy(point.y)}" r="${(((point.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.1) * scale) / 2).toFixed(3)}" fill="#101e30"/>`,
              )
            }
    }
    for (const connection of output ? [] : connections) {
      const name = signalNames.get(connection.name) ?? connection.name
      const color = channelColors[Number(name.match(/^EMI(\d)/)?.[1] ?? 0)]
      const [a, b] = connection.pointsToConnect
      // Dashed airwires are connectivity requests, never proposed copper paths.
      s.push(
        `<path d="M${sx(a.x)},${sy(a.y)} L${sx(b.x)},${sy(b.y)}" fill="none" stroke="${color}" stroke-width="${id === "overview" ? 0.8 : 1.3}" stroke-dasharray="4 4" opacity="${id === "overview" ? 0.45 : 0.8}"><title>${escape(name)} — unrouted airwire</title></path>`,
      )
      if (id === "byte_detail") {
        for (const p of [a, b])
          s.push(
            `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.5" fill="${color}"/>`,
          )
      }
    }
    s.push("</g>")
    return s.join("\n")
  }
  const overview = panel(
    "overview",
    24,
    132,
    760,
    700,
    input.bounds,
    input.connections,
  )
  const detail = panel(
    "byte_detail",
    810,
    132,
    566,
    548,
    { minX: -13.5, maxX: 1.5, minY: 8, maxY: 28.5 },
    selected,
  )
  const labels = selected
    .map((connection) => signalNames.get(connection.name))
    .join(" · ")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900" viewBox="0 0 1400 900">
<title>MT8395 LPDDR4X — ${output ? "validated completed DDR routes" : "exact core input, no accepted routes"}</title>
<desc>${output ? "Completed routes validated for connectivity, DRC, timing, coupling and via-in-pad prohibition." : "Diagnostic input snapshot. Dashed lines are unrouted connectivity requests."} All 1446 pads remain obstacles.</desc>
<defs>${definitions.join("\n")}</defs>
<rect width="1400" height="900" fill="#091422"/>
<g font-family="sans-serif">
<text x="24" y="37" fill="#f6bc62" font-size="18" font-weight="bold">${output ? `ROUTED DDR — ${input.connections.length} / ${input.connections.length} SIGNALS` : "UNROUTED INPUT — NOT A COMPLETED PCB"}</text>
<text x="24" y="75" fill="#e1e8f0" font-size="28">MT8395AV/ZA + two LPDDR4X packages · ${input.connections.length} ${output ? "routed signals" : "signal requests"}</text>
<text x="24" y="105" fill="#adbed2" font-size="15">Exact core SRJ · 1,446 circular pad obstacles · 8 layers · via-in-pad disabled · ${output ? "independently validated routes" : "no input normalization"}</text>
${overview}
${detail}
<text x="832" y="711" fill="#62d6fa" font-size="17">Inset: EMI1 byte zero · ${selected.length} ${output ? "routed signals" : "unrouted requests"}</text>
<text x="832" y="741" fill="#adbed2" font-size="14">DQ0–DQ7, DMI0, DQS0_T/C · layer inner2</text>
<text x="832" y="768" fill="#adbed2" font-size="14">60 μm width / clearance · 0.20 / 0.10 mm vias</text>
<text x="832" y="795" fill="#adbed2" font-size="14">Byte skew ≤0.50 mm · DQS skew ≤0.10 mm</text>
<text x="832" y="822" fill="#f6bc62" font-size="12">${output ? "White: TOP · cyan: inner2 · violet: inner4 · gold: inner6" : "Dashed lines are airwires. No routed copper is shown."}</text>
<text x="24" y="866" fill="#adbed2" font-size="13">Research fixture only: power circuitry, reference planes and electrical qualification are absent.</text>
</g>
<!-- ${escape(labels)} -->
</svg>\n`
}
export function renderInputSnapshot(
  input: SimpleRouteJson,
  metadata: CaptureMetadata,
) {
  if (input.traces?.length)
    throw Error("Input-only snapshot refuses routed or partial copper")
  return renderSnapshot(input, metadata)
}
export function renderRoutedSnapshot(
  input: SimpleRouteJson,
  metadata: CaptureMetadata,
  output: SimpleRouteJson,
) {
  const { traces: _, ...geometry } = output
  const { traces: __, ...original } = input
  if (
    inputHash(geometry) !== inputHash(original) ||
    !validateOutput(input, output).accepted
  )
    throw Error(
      "Routed snapshot requires unchanged input and complete, validated copper",
    )
  return renderSnapshot(input, metadata, output)
}
if (import.meta.main) {
  const { input, metadata } = loadCase("full")
  const directory = process.argv[2] ?? `${import.meta.dir}/results/full`
  const report = JSON.parse(readFileSync(`${directory}/report.json`, "utf8"))
  if (
    !report.solved ||
    report.failed ||
    !report.accepted ||
    report.inputSha256 !== metadata.inputSha256
  )
    throw Error("Snapshot export requires a successful full-board solve report")
  const output = JSON.parse(
    readFileSync(`${directory}/accepted.srj.json`, "utf8"),
  )
  if (report.outputSha256 !== inputHash(output))
    throw Error("Snapshot copper does not match the successful solve report")
  writeFileSync(
    `${import.meta.dir}/board.snap.svg`,
    renderRoutedSnapshot(input, metadata, output),
  )
  console.log("Wrote validated completed DDR snapshot")
}
