import { test } from "bun:test"
import { expectPreloadedByteRouting } from "./fixtures/expect-preloaded-byte-routing"

test("routes A64 byte2 without changing the supplied first two bytes", async (): Promise<void> => {
  await expectPreloadedByteRouting({
    fixtureName: "a64-preloaded-byte",
    testPath: import.meta.path,
  })
}, 120_000)
