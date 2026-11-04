import { BusLanesPipelineSolver } from "../../../lib/bus-lanes-pipeline-solver"

// Observe the real solver without changing its input, options or acceptance.
export const runs: BusLanesPipelineSolver[] = []
export class ReviewedSolver extends BusLanesPipelineSolver {
  private lastReport = 0
  constructor(...args: ConstructorParameters<typeof BusLanesPipelineSolver>) {
    super(...args)
    runs.push(this)
  }
  override step() {
    super.step()
    const now = performance.now()
    if (now - this.lastReport > 20000) {
      this.lastReport = now
      console.log(
        JSON.stringify({
          elapsedSeconds: now / 1000,
          phase: this.phase,
          iterations: this.iterations,
          state: this.stats.nativeGroups,
        }),
      )
    }
  }
}
