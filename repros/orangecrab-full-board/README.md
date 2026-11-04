# OrangeCrab with retained full-board copper

Run from the repository root:

```sh
bun install
bun test tests/repros/orangecrab-full-board.test.ts --timeout 120000
```

This replays the unchanged [source-derived capture](../../tests/fixtures/orangecrab-r0.2.1/README.md) through `BusLanesPipelineSolver` with its default options. It requests the original eleven byte-zero connections while retaining 1,430 obstacles and 996 fixed wire runs. The shared source fixture preserves all 163 PCB components and the six-layer board, and removes exactly the already-recorded 19 PCB trace records and 22 vias. The test waits for search exhaustion rather than imposing an additional elapsed routing cutoff; its test timeout remains 120 seconds.

The original filled pours remain visible reference geometry; the captured SRJ does not model refilled zones. Any eventual routing-model completion still requires native KiCad refill and board-level validation before fabrication acceptance.

At base `54dfacbd959582fee0f0f5a121015842d5b13794`, the solver accepts the outline but fails with `coupled_routing_failed`: `No legal coupled corridor and package approaches`. It accepts zero new traces and preserves its input and supplied copper. The expected-failure regression passes; production solver code is unchanged.

The [snapshot](../../tests/repros/__snapshots__/orangecrab-full-board-pcb.snap.svg) shows the actual retained PCB and a clearly labeled failed baseline. It uses the existing `toMatchPcbSnapshot` helper and PCB renderer, with no custom SVG exporter. A fixing PR must update this same snapshot after complete connectivity, native DRC, bus/pair length and coupling checks pass. The failed-baseline exception applies only to this named reproduction.

Shibo's [two-byte TSX/core case](../orangecrab-data-bytes/README.md) is a separate control: it retains the five extracted source footprints and 387 pads, while omitting existing copper and unrelated circuitry. It passes 22/22 signals on this base. That result does not establish completion of this retained full-board request.

A fresh conversion of the shared Circuit JSON with published `tscircuit@0.0.3075` / core `0.0.2266` emits 152 connections and the same 1,430 pad obstacles, but no retained trace array or captured bus/pair constraints. Its outline has 69 points and its routing bounds also differ. The pinned Shibo runtime (`tscircuit@0.0.3047` / core `0.0.2245`) produces the same connection/obstacle counts and also omits those routing settings. This PR does not patch either output back into the captured request or claim that the inputs are equivalent; the public import/routing-intent path remains a separate integration question.

No pad reconstruction, obstacle-shape conversion, supplied pair corridor or explicit bus-length target is added. Source hashes, removed-element identities and unrelated-element preservation remain covered by `tests/repros/orangecrab-reference.test.ts`.

Benchmark effect: tests, the labeled snapshot and this reproduction description do not change the production `lib/` tree, benchmark inputs, harness or budgets. Fresh paired 11-case AM3352 acceptance is still required for the PR head; no performance improvement is claimed.
