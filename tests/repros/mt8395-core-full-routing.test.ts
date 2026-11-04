import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadCase } from "../../repros/mt8395-lpddr4x/input"

// Keep the large fresh solve in a bounded-heap child so preceding fixture tests
// cannot retain its routing grids. This runs in the existing test workflow.
test("fresh exact core full request completes all 138 DDR signals", async () => {
  Bun.gc(true)
  const root = resolve(import.meta.dir, "../..")
  const label = `test-full-${process.pid}`
  const child = Bun.spawn(
    [
      process.execPath,
      "repros/mt8395-lpddr4x/run.ts",
      "full",
      "--timeout-ms",
      "1800000",
      "--label",
      label,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        BUN_JSC_forceRAMSize: "2147483648",
        BUN_JSC_miniVMHeapGrowthFactor: "1.05",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  const timer = setTimeout(() => child.kill(), 1830000)
  try {
    expect(await child.exited).toBe(0)
    const report = JSON.parse(
      readFileSync(
        resolve(root, `repros/mt8395-lpddr4x/results/${label}/report.json`),
        "utf8",
      ),
    )
    expect(report.inputSha256).toBe(loadCase("full").metadata.inputSha256)
    expect(report.inputUnchanged).toBe(true)
    expect(report.solved).toBe(true)
    expect(report.failed).toBe(false)
    expect(report.accepted).toBe(true)
    expect(report.acceptedSignals).toBe(138)
    expect(report.validation.invalidGeometry).toEqual([])
    expect(report.validation.viaInPad).toEqual([])
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill()
  }
}, 1860000)
