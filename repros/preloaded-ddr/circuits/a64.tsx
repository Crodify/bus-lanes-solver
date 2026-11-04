import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { NativeDdrBoard } from "./native-ddr-board"

const source = JSON.parse(
  gunzipSync(readFileSync(new URL("./a64.json.gz", import.meta.url))).toString(
    "utf8",
  ),
)
export const board = (
  <NativeDdrBoard
    source={source}
    dataOnly={process.env.DDR_DATA_ONLY === "1"}
  />
)
