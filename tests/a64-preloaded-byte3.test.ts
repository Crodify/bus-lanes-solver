import { test } from "bun:test"
import { expectPreloadedByteRouting } from "./fixtures/expect-preloaded-byte-routing"

test("routes A64 byte3 without changing the supplied first three bytes", async (): Promise<void> => {
  await expectPreloadedByteRouting({
    fixtureName: "a64-preloaded-byte3",
    testPath: import.meta.path,
  })
}, 120_000)
