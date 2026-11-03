import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { inputHash, loadCase } from "../repros/mt8395-lpddr4x/input"
import { renderRoutedSnapshot } from "../repros/mt8395-lpddr4x/snapshot"

test("retained byte snapshot reproduces independently validated copper from its successful solve", () => {
  const root = new URL("../repros/mt8395-lpddr4x/", import.meta.url)
  const { input, metadata } = loadCase("byte0")
  const report = JSON.parse(
    readFileSync(new URL("routed/byte0-report.json", root), "utf8"),
  )
  const output = JSON.parse(
    gunzipSync(
      readFileSync(new URL("routed/byte0.srj.json.gz", root)),
    ).toString(),
  )
  expect(report.solved).toBe(true)
  expect(report.failed).toBe(false)
  expect(report.acceptedSignals).toBe(11)
  expect(report.inputSha256).toBe(metadata.inputSha256)
  expect(report.outputSha256).toBe(inputHash(output))
  const svg = renderRoutedSnapshot(input, metadata, output)
  expect(svg).toBe(readFileSync(new URL("byte0.snap.svg", root), "utf8"))
  expect(svg).toContain("11 / 11 SIGNALS")
  expect(svg).not.toContain("stroke-dasharray")
  expect(() =>
    renderRoutedSnapshot(input, metadata, {
      ...output,
      allowedLayers: ["inner2"],
    }),
  ).toThrow("unchanged input")
}, 30000)
