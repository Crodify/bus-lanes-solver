import { expect, test } from "bun:test"
import { checkPcbTraceSelfShorts } from "@tscircuit/checks"
import { generatedTraceTerminalViasAreClear } from "../lib/terminal-via-clearance"
import type { Trace } from "../lib/types"
import { loadCase } from "../repros/mt8395-lpddr4x/input"
import regressions from "./fixtures/mt8395-core/via-approach-regression.json"

// Actual terminal geometry rejected by core at bf1bd6e: EMI0_CK_T and EMI1_DQS0_T.
// Keep these small failed geometry fixtures separate from completed snapshots.
for (const regression of regressions) {
  test(`${regression.connection_name}: reject the paired curve touching its own via land`, () => {
    const { input } = loadCase("full")
    const trace = {
      type: "pcb_trace",
      pcb_trace_id: "regression",
      source_trace_id: "signal",
      connection_name: "signal",
      route: [...regression.path, regression.via],
    } as Trace
    expect(generatedTraceTerminalViasAreClear(input, trace)).toBe(false)
    const check = (t: Trace) =>
      checkPcbTraceSelfShorts([
        { type: "pcb_board", pcb_board_id: "board", num_layers: 8 },
        {
          type: "source_bus",
          source_bus_id: "bus",
          max_length_skew: 0.1,
          source_trace_ids: ["signal"],
        },
        {
          type: "source_trace",
          source_trace_id: "signal",
          name: "signal",
          connected_source_port_ids: [],
          connected_source_net_ids: [],
        },
        t,
        {
          type: "pcb_via",
          pcb_via_id: "via",
          pcb_trace_id: "regression",
          ...regression.via,
          outer_diameter: 0.2,
          hole_diameter: 0.1,
        },
      ] as any)
    expect(check(trace)).toHaveLength(1)
    const straight = {
      ...trace,
      route: [
        {
          ...regression.path[0],
          x: regression.via.x,
          y: regression.via.y - 0.5,
        },
        { ...regression.path[0], x: regression.via.x, y: regression.via.y },
        regression.via,
      ],
    } as Trace
    expect(generatedTraceTerminalViasAreClear(input, straight)).toBe(true)
    expect(check(straight)).toHaveLength(0)
  })
}
