# Repro: STMP157 fourth DDR data byte

Captured without geometry edits from the real OLIMEX STMP157-OLinuXino-LIME2 rev B1 subsystem (STM32MP157CAA3x and two Samsung K4B4G1646D-BYK0 memories), rendered from TSX through published `tscircuit 0.0.3064` / `@tscircuit/core 0.0.2260` / autorouter `0.0.1035`.

Source: [OLIMEX/OLINUXINO](https://github.com/OLIMEX/OLINUXINO/blob/85eee9c17ee13af65617d73bdd94de7ec49cfb42/HARDWARE/STMP157-OLinuXino-LIME2/1.%20Latest%20hardware%20revision/STMP157-OLinuXino-LIME2_Rev_B1/STMP157-OLinuXino-LIME2_Rev_B1.kicad_pcb), commit `85eee9c17ee13af65617d73bdd94de7ec49cfb42`, CC-BY-SA-3.0-US. Original board SHA-256: `260a8c8429a14645014ab20f9ba4e3f04dadf3433453895dd43919bb65b0f79e`.

`input.srj.json.gz` is the fourth-byte bus phase input: eight requested connections, 24 supplied earlier-byte traces, eight physical layers, 0.127 mm trace width and clearance, 0.327/0.2 mm via pad/drill. Pads, terminals, supplied copper and routing rules retain the native board geometry. The gzip has a zero timestamp; compressed SHA-256: `e8d15974d7993c9ff6ede2b85bc2529593c13eb6262163fb67aa547cbfd3b4db`.

On base `005bee4ae0af17cea30108e4f57d58cd4b2dc430`, routing exhausts because three generated native pad-to-via approaches are not axis/45-degree wires. The lanes themselves have been found. The test exports the actual failed solver visualization before asserting complete routing, so this repro is intentionally red. Its caption identifies unaccepted candidate copper. The stacked fix changes the same `tests/__snapshots__/stmp157-byte3.snap.svg`; completed snapshots require all eight connections, DRC and the first 24 traces to pass. No copper geometry is drawn by hand.

The fixture is a routing-only data-byte phase; no timing/skew constraints were invented. It does not claim full 72-net board routing or timing closure.

Run `bun test tests/stmp157-byte3.test.ts --timeout 120000`. Set `BUN_UPDATE_SNAPSHOTS=1` to regenerate the diagnostic snapshot. The repro still fails its routing assertion; the stacked fix must pass the same test and its successful-output checks.

This follows Seve’s [repro-first stack](https://github.com/tscircuit/bus-lanes-solver/pull/134), including a narrowly scoped failed-image exception. Production solver code and the AM3352 benchmark are unchanged in the repro.
