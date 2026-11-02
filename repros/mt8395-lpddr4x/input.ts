import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { SimpleRouteJson } from "../../lib/types"

export const caseNames = ["full", "byte0", "pair"] as const
export type CaseName = (typeof caseNames)[number]
export function inputHash(input: SimpleRouteJson): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex")
}
export interface CaptureMetadata {
  scope: CaseName
  inputSha256: string
  signals: { sourceTraceId: string; name: string; endpoints: string }[]
}
/** Immutable core output in board-world mm, +X right and +Y up. */
export function loadCase(name: CaseName) {
  const input: SimpleRouteJson = JSON.parse(
    readFileSync(
      `${import.meta.dir}/../../tests/fixtures/mt8395-core/${name}.srj.json`,
      "utf8",
    ),
  )
  const metadata: CaptureMetadata = JSON.parse(
    readFileSync(
      `${import.meta.dir}/../../tests/fixtures/mt8395-core/${name}.metadata.json`,
      "utf8",
    ),
  )
  if (inputHash(input) !== metadata.inputSha256)
    throw Error(`The original core ${name} input changed`)
  return { input, metadata }
}
