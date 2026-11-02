import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { BusLanesPipelineSolver } from "../lib"
import type { Obstacle, Point, SimpleRouteJson } from "../lib/types"
import { orangecrabByte0, orangecrabCircuit } from "../tests/fixtures/orangecrab"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { packageApproachRegions } from "../lib/package-approach-regions"
import { offsetPackageCenterlines } from "../lib/offset-package-centerlines"
import { offsetPath } from "../lib/coupled-pair-routing"
import { nativePairHalfPitch } from "../lib/native-pair-spacing"
import { length, simplify } from "../lib/geometry"
import { toNativeValidationSrj } from "../lib/native-validation-input"
import { validateOriginalEndpointConnectivity, validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { pairCouplingReports } from "../lib/pair-coupling"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { nativeSignalGeometryIsValid } from "../lib/native-signal-geometry"

function property(element: object | undefined, name: string): unknown {
  return element ? Reflect.get(element, name) : undefined
}
function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}
function requireTrue(value: unknown, message: string): asserts value {
  if (!value) throw Error(message)
}

/** Exact captured geometry. Curved pads and fixed tracks become unions of
 * rectangles/circles/capsules; no pad, barrel, track or source file is moved. */
export function orangecrabRoutingView(original: SimpleRouteJson) {
  const elements = orangecrabCircuit()
  const pads = new Map(elements.flatMap((element) =>
    element.type === "pcb_smtpad" ? [[element.pcb_smtpad_id, element] as const] : [],
  ))
  const holes = new Map(elements.flatMap((element) =>
    element.type === "pcb_plated_hole" ? [[element.pcb_plated_hole_id, element] as const] : [],
  ))
  const obstacles = original.obstacles.flatMap((obstacle): Obstacle[] => {
    const metadata = (obstacle as Obstacle & {
      circuitJsonMetadata?: { pcb_smtpad_id?: string; pcb_plated_hole_id?: string }
    }).circuitJsonMetadata
    const pad = pads.get(metadata?.pcb_smtpad_id ?? "")
    const hole = holes.get(metadata?.pcb_plated_hole_id ?? "")
    const holeShape = property(hole, "shape")
    if (holeShape === "circle") return [{ ...obstacle, type: "rect", shape: "circle" }]
    const padRadius = property(pad, "corner_radius")
    const holeRadius = property(hole, "rect_border_radius")
    const radius = typeof padRadius === "number" ? padRadius
      : typeof holeRadius === "number" ? holeRadius
      : obstacle.type === "oval" || holeShape === "pill" || holeShape === "oval"
        ? Math.min(obstacle.width, obstacle.height) / 2 : 0
    if (!radius) return [{ ...obstacle }]
    const r = Math.min(radius, obstacle.width / 2, obstacle.height / 2)
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const parts: Obstacle[] = []
    if (obstacle.width > 2 * r) parts.push({ ...obstacle, type: "rect", shape: undefined, width: obstacle.width - 2 * r })
    if (obstacle.height > 2 * r) parts.push({ ...obstacle, type: "rect", shape: undefined, height: obstacle.height - 2 * r })
    const seen = new Set<string>()
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const dx = x * (obstacle.width / 2 - r), dy = y * (obstacle.height / 2 - r)
      const center = { x: obstacle.center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: obstacle.center.y + dx * Math.sin(angle) + dy * Math.cos(angle) }
      const key = JSON.stringify(center)
      if (seen.has(key)) continue
      seen.add(key)
      parts.push({ ...obstacle, type: "rect", shape: "circle", center, width: 2 * r, height: 2 * r })
    }
    return parts
  })
  const immutable = fixedCopper({ ...original, obstacles: [] })
  const fixedObstacles: Obstacle[] = immutable.map((copper) => {
    const span = Math.hypot(copper.b.x - copper.a.x, copper.b.y - copper.a.y)
    return { type: span < 1e-12 ? "rect" : "oval", shape: span < 1e-12 ? "circle" : undefined,
      center: { x: (copper.a.x + copper.b.x) / 2, y: (copper.a.y + copper.b.y) / 2 },
      width: span + 2 * copper.radius, height: 2 * copper.radius,
      ccwRotationDegrees: Math.atan2(copper.b.y - copper.a.y, copper.b.x - copper.a.x) * 180 / Math.PI,
      layers: [copper.layer], connectedTo: copper.owners }
  })
  return { ...original, allowedLayers: [...original.allowedLayers!], traces: [], obstacles: [...obstacles, ...fixedObstacles] }
}

/** Reproduce the finite, clear-space corridor search used during diagnosis.
 * Only geometry is searched; no original or saved DDR trace is supplied. */
function generatedPairCorridor({ input, original }: { input: SimpleRouteJson; original: SimpleRouteJson }) {
  const native = { ...input, allowedLayers: ["inner2"] }
  const pair = native.differentialPairs![0]
  const copper = fixedCopper(native)
  const halfPitch = nativePairHalfPitch(native, pair)
  const scenes = pair.connectionNames.map((name) => {
    const connection = native.connections.find((c) => c.name === name)!
    return new VectorScene(native, { ...connection, pointsToConnect: connection.pointsToConnect.map((p) => ({ ...p, layer: "inner2" })) }, native.minTraceWidth, copper)
  })
  const candidates = offsetPackageCenterlines({ input: native, defaults: [[]],
    regions: packageApproachRegions(original, 0.2225), stepMm: native.minTraceWidth })
  requireTrue(candidates, "Expected two offset native packages")
  const bases: Point[][] = []
  for (const candidate of candidates) {
    if (!candidate) break
    const path = candidate[0], first = path[0], last = path.at(-1)!
    const monotone = path.slice(1).every((point, i) =>
      (point.x - path[i].x) * (last.x - first.x) >= -1e-8 &&
      (point.y - path[i].y) * (last.y - first.y) >= -1e-8)
    if (!monotone) break
    bases.push(path)
  }
  const seen = new Set<string>()
  const clear: Array<{ path: Point[]; addedLengthMm: number }> = []
  const bevelMm = native.minTraceWidth * 2
  for (const path of bases) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    if (Math.abs(a.y - b.y) > 1e-8 || Math.abs(a.x - b.x) < 2) continue
    const dx = Math.sign(b.x - a.x), span = Math.abs(b.x - a.x)
    for (const width of [1.1, 1.5, 1.9, 2.3])
      for (let along = width / 2 + 0.2; along < span - width / 2 - 0.2; along += 0.25)
        for (const height of [0.75, 1, 1.25, 1.5]) for (const side of [-1, 1]) {
          const x = a.x + dx * along, start = x - dx * width / 2, end = x + dx * width / 2, y = a.y, c = bevelMm
          const jog = [{ x: start, y }, { x: start + dx * c, y: y + side * c },
            { x: start + dx * c, y: y + side * (height - c) },
            { x: start + dx * 2 * c, y: y + side * height },
            { x: end - dx * 2 * c, y: y + side * height },
            { x: end - dx * c, y: y + side * (height - c) },
            { x: end - dx * c, y: y + side * c }, { x: end, y }]
          const variant = simplify([...path.slice(0, i), ...jog, ...path.slice(i)])
          const key = JSON.stringify(variant)
          if (seen.has(key)) continue
          seen.add(key)
          try {
            if (!scenes.every((scene, rail) => scene.pathVisible(offsetPath(variant, (rail ? 1 : -1) * halfPitch)))) continue
          } catch { continue }
          clear.push({ path: variant, addedLengthMm: length(variant) - length(path) })
        }
  }
  clear.sort((a, b) => Math.abs(a.addedLengthMm - 2.3) - Math.abs(b.addedLengthMm - 2.3))
  requireTrue(clear.length, "No clear generated paired corridor")
  console.log(JSON.stringify({ stage: "generated-corridor", directCandidates: bases.length, clearDetours: clear.length, addedLengthMm: clear[0].addedLengthMm }))
  return [clear[0].path]
}

export async function solveOrangecrabDiagnostic() {
  const fixtureRoot = new URL("../tests/fixtures/orangecrab-r0.2.1/", import.meta.url)
  const sourceBytes = readFileSync(new URL("byte0.srj.json", fixtureRoot))
  const circuitBytes = readFileSync(new URL("original.circuit.json", fixtureRoot))
  requireTrue(sha256(sourceBytes) === "d35e1db264568b8994b144526b78e1de788339c02205ff977a955b59d6b9828f", "Canonical SRJ changed")
  requireTrue(sha256(circuitBytes) === "22a2fd135fadc363f7712ead3cd05533c4b5c412fb055d1e55e704e1cdbe433e", "Canonical Circuit JSON changed")
  const original = orangecrabByte0(), originalBefore = JSON.stringify(original)
  const requested = new Set(original.connections.map((c) => c.name))
  requireTrue(!original.traces?.some((t) => requested.has(t.connection_name!)), "Requested net retains fixed copper")
  const input = orangecrabRoutingView(original), inputBefore = JSON.stringify(input)
  const options = { maxRoutingTimeMs: 7200000, singleCarrier: {
    packageRegions: packageApproachRegions(original, 0.2225),
    centerlines: generatedPairCorridor({ input, original }), busTargetLength: 15.35,
    carrierLayer: "inner2", ordinaryCarrierLayers: ["bottom", "inner2"],
    maxApproachPasses: 1, maxPasses: 1, maxLocalPasses: 12, fineGridStep: 0.5 / 6,
    maxExpansionsPerRoute: 100000, maxStrictExpansionsPerRoute: 5000,
  } }
  const solver = new BusLanesPipelineSolver(input, options), started = performance.now()
  let last = 0
  while (!solver.solved && !solver.failed) {
    solver.step()
    const seconds = (performance.now() - started) / 1000
    if (seconds - last > 30) {
      last = seconds
      console.log(JSON.stringify({ seconds, phase: solver.phase, iterations: solver.iterations, stats: solver.stats }))
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  requireTrue(solver.solved, solver.error ?? "Fresh routing did not solve")
  requireTrue(!solver.failed && !solver.error, "Solved state is inconsistent")
  requireTrue(JSON.stringify(original) === originalBefore && JSON.stringify(input) === inputBefore && JSON.stringify(solver.input) === inputBefore, "Input mutated")
  const native = { inputSrj: toNativeValidationSrj(input), routedSrj: toNativeValidationSrj(solver.getOutput()) }
  const connectivity = validateOriginalEndpointConnectivity(native)
  const drc = validateRoutedCopperDrc({ ...native, clearance: input.minTraceToPadEdgeClearance!, allowBlindAndBuriedVias: false })
  const buses = busLengthReports(original, solver.traces), pairs = pairLengthReports(original, solver.traces)
  const coupling = pairCouplingReports(original, solver.traces), shared = sharedPairSpacingReports(original, solver.traces), exterior = exteriorPairSpacingReports(original, solver.traces)
  requireTrue(connectivity.valid && connectivity.connectedConnectionCount === 11, "Incomplete endpoint connectivity")
  requireTrue(drc.valid && drc.issues.length === 0, "New copper DRC failed")
  requireTrue(buses.every((b) => b.aboveMinimumLength && b.withinLengthLimit && b.matched), "Bus matching failed")
  requireTrue(pairs.every((p) => p.matched) && coupling.every((p) => p.matched) && shared.every((p) => p.matched) && exterior.every((p) => p.matched), "Pair matching/coupling failed")
  requireTrue(solver.traces.every(nativeSignalGeometryIsValid), "Native signal geometry failed")
  requireTrue(sha256(readFileSync(new URL("byte0.srj.json", fixtureRoot))) === sha256(sourceBytes) &&
    sha256(readFileSync(new URL("original.circuit.json", fixtureRoot))) === sha256(circuitBytes), "Source file changed")
  const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim()
  const report = { purpose: "Fresh OrangeCrab DDR byte-0 routing-model solve; no saved routes supplied",
    solverCommit: commit, bunVersion: Bun.version, seconds: (performance.now() - started) / 1000,
    solved: solver.solved, sourceSrjSha256: sha256(sourceBytes), sourceCircuitSha256: sha256(circuitBytes),
    sourceUnchanged: true, inputUnchanged: true, connectivity, drc, buses, pairs, coupling, shared, exterior,
    options, modelScope: "Original pads, tracks and via lands retained exactly. Filled pours are excluded from this routing model. Original KiCad baseline has 55 clearance findings; native zone refill and derived-board DRC remain required. This is not whole-board fabrication acceptance." }
  mkdirSync("work/orangecrab-diagnostic", { recursive: true })
  writeFileSync("work/orangecrab-diagnostic/report.json", JSON.stringify(report, null, 2))
  writeFileSync("work/orangecrab-diagnostic/completed-route.srj.json", JSON.stringify(solver.getOutput()))
  console.log(JSON.stringify({ solved: true, connected: connectivity.connectedConnectionCount, nativeDrcIssues: drc.issues.length, seconds: report.seconds }))
  return { solver, input, original, report }
}
