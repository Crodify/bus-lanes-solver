# Fresh AM3352 base/head controls

All **11/11** unchanged AM3352 placements freshly solve **47/47** signals on both revisions: **517/517** in aggregate. Connectivity, combined copper DRC, full-copper bus/pair matching and pair coupling pass. Every case preserves all **161** supplied power dogbones and their pad joins.

The complete output SRJ is byte-equivalent between base and head for every placement. Each snapshot therefore represents both revisions. These controls have no routing regression from the H3/A64 escape-site fix.

Base production source: `afe52fdccd276c39387ad022addf26f7ad21926d`; head: `e151a5d673bb2e575d549a0f98f4ee67885150db`. Adding this gallery changes documentation only; production routing and benchmark inputs remain unchanged.

The [required Blacksmith comparison](https://github.com/tscircuit/bus-lanes-solver/actions/runs/41844093287) finished with its **11/11 acceptance check green**. The table below is from the separate fresh local pair: Bun 1.4.3, four CPU quota cores, 16 GiB memory, one serial worker per revision, two concurrent workers, 3,600 seconds per solve. Local timings are single-run observations. Total solve seconds: **1878.306 → 1889.589**.

| Placement | Signals, base → head | DRC findings | Bus skews by group, mm (unchanged) | Pair0 / pair1 / pair2 skew, mm (unchanged) | Coupling, base → head | Solve seconds, base → head |
| --- | --- | --- | --- | --- | --- | --- |
| [control](control-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.635000 / 0.635000 | 0.077868 / 0.126884 / 0.072830 | pass → pass | 24.760 → 24.616 |
| [control-inner1](control-inner1-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.635000 / 0.635000 | 0.048900 / 0.004720 / 0.030215 | pass → pass | 616.192 → 610.686 |
| [right](right-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.635000 / 0.635000 | 0.096047 / 0.121802 / 0.102644 | pass → pass | 19.941 → 20.319 |
| [left](left-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.635000 / 0.511147 | 0.010514 / 0.127000 / 0.105429 | pass → pass | 25.549 → 25.235 |
| [above](above-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.635000 / 0.635000 | 0.127000 / 0.127000 / 0.127000 | pass → pass | 28.897 → 28.642 |
| [inner-layers](inner-layers-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.635000 / 0.635000 | 0.077868 / 0.126884 / 0.127000 | pass → pass | 36.106 → 35.837 |
| [inner-layers-right](inner-layers-right-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.635000 / 0.635000 | 0.127000 / 0.127000 / 0.127000 | pass → pass | 51.749 → 51.883 |
| [inner-layers-left](inner-layers-left-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.634990 / 0.634992 | 0.126990 / 0.000001 / 0.105429 | pass → pass | 123.488 → 123.919 |
| [inner-layers-above](inner-layers-above-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.634991 / 0.634993 | 0.126915 / 0.126990 / 0.000001 | pass → pass | 145.946 → 157.171 |
| [inner-layers-complete-ca](inner-layers-complete-ca-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.634990 / 0.634992 / 0.634994 | 0.075359 / 0.000000 / 0.066384 | pass → pass | 178.590 → 176.830 |
| [outer-layers](outer-layers-solved.png) | 47/47 → 47/47 | 0 → 0 | 0.635000 / 0.635000 | 0.019219 / 0.127000 / 0.127000 | pass → pass | 627.088 → 634.449 |

Bus skew limits are 0.635 mm and pair skew limits are 0.127 mm. Matching includes the fixed approaches and new interconnect; a routing-only pass is not counted as matched. Complete metrics, including pair coupling gaps, quality and all input-preservation checks, are retained in [base-results.json.gz](base-results.json.gz) and [head-results.json.gz](head-results.json.gz).

Input/output/image hashes, environment, revision trees and exact commands are in [provenance.json](provenance.json). The exporter validates all eleven complete outputs against the original fixtures before rendering any image. Every published image was visually inspected.
