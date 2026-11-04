import { test } from "bun:test"
import { expectPreloadedByteRouting } from "./fixtures/expect-preloaded-byte-routing"

test("routes H3 byte1 without changing the supplied byte0 copper", async (): Promise<void> => {
  await expectPreloadedByteRouting({
    fixtureName: "h3-preloaded-byte",
    testPath: import.meta.path,
  })
}, 120_000)
