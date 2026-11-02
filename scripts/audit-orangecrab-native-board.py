from pathlib import Path
import collections, hashlib, json, math, os
import pcbnew
root = Path("work/native-audit")
build = json.loads((root / "native/build-audit.json").read_text())
source = Path("work/native-source/OrangeCrab.kicad_pcb")
reports = {name: json.loads((root / f"native/{name}/drc.json").read_text()) for name in ["baseline", "rerouted"]}
def signature(violation):
    items = sorted((item.get("description", ""), json.dumps(item.get("pos", item.get("position", {})), sort_keys=True)) for item in violation.get("items", []))
    return json.dumps([violation.get("type"), violation.get("severity"), violation.get("description"), items], sort_keys=True)
baseline = collections.Counter(signature(v) for v in reports["baseline"].get("violations", []))
rerouted = collections.Counter(signature(v) for v in reports["rerouted"].get("violations", []))
extra = rerouted - baseline
selected = set(build["selectedNativeNets"])
def frozen(board):
    pads = sorted((p.GetParentFootprint().GetReference(), p.GetNumber(), p.GetNetname(), p.GetPosition().x, p.GetPosition().y, p.GetSize().x, p.GetSize().y, p.GetDrillSize().x, p.GetDrillSize().y, int(p.GetShape()), p.GetOrientationDegrees(), p.GetLayerSet().FmtHex()) for p in board.GetPads())
    components = sorted((f.GetReference(), f.GetValue(), f.GetPosition().x, f.GetPosition().y, f.GetOrientationDegrees(), f.GetLayer()) for f in board.GetFootprints())
    copper = []
    for t in board.GetTracks():
        if t.GetNetname() in selected: continue
        via = isinstance(t, pcbnew.PCB_VIA)
        item = [t.GetClass(), t.GetNetname(), t.GetStart().x, t.GetStart().y, t.GetEnd().x, t.GetEnd().y, t.GetWidth(pcbnew.F_Cu) if via and pcbnew.Version().startswith("10.") else t.GetWidth(), t.GetLayer()]
        if via: item += [t.GetDrillValue(), t.TopLayer(), t.BottomLayer()]
        copper.append(tuple(item))
    return pads, components, sorted(copper)
source_board = pcbnew.LoadBoard(str(source.parent / "unfilled-source.kicad_pcb"))
result_board = pcbnew.LoadBoard(str(root / "native/rerouted/OrangeCrab.kicad_pcb"))
before, after = frozen(source_board), frozen(result_board)
assert before == after, "Unrelated native pad/component/copper geometry changed"
assert len(after[1]) == 163 and result_board.GetCopperLayerCount() == 6
routing = json.loads((root / "completed-route.srj.json").read_text())
names = {c["name"] for c in routing["connections"]}
lengths = {}
for trace in routing["traces"]:
    if trace.get("connection_name") not in names: continue
    points = [(round(p["x"] + 159.91, 6), round(102.95 - p["y"], 6)) for p in trace["route"]]
    lengths[trace["connection_name"]] = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
skew = max(lengths.values()) - min(lengths.values())
summary = {"purpose": "Native copper/connectivity audit only; not whole-board acceptance",
 "kicadVersion": pcbnew.Version(), "sourceUnchanged": hashlib.sha256(source.read_bytes()).hexdigest() == "4597f3ac08e21c09253b27ca1b9e26aaf3c3d3e2147b6c0d79c0dc6aa555e201",
 "baselineViolationsByType": dict(collections.Counter(v.get("type") for v in reports["baseline"].get("violations", []))),
 "reroutedViolationsByType": dict(collections.Counter(v.get("type") for v in reports["rerouted"].get("violations", []))),
 "newViolationsByType": dict(collections.Counter(json.loads(key)[0] for key in extra.elements())),
 "baselineViolations": sum(baseline.values()), "reroutedViolations": sum(rerouted.values()), "newViolations": sum(extra.values()),
 "baselineUnconnectedItems": len(reports["baseline"].get("unconnected_items", [])), "reroutedUnconnectedItems": len(reports["rerouted"].get("unconnected_items", [])),
 "originalPadComponentFixedCopperUnchanged": before == after, "componentCount": 163, "layerCount": 6,
 "quantizedBusSkewMm": skew, "quantizedBusMatched": skew <= 1 + 1e-7, "quantizedPairSkewMm": abs(lengths["source_net_10"] - lengths["source_net_6"]),
 "limits": "KiCad coordinate rounding is audited separately; source-board violations remain. No fabrication acceptance or signal-integrity qualification."}
(root / "native/native-audit.json").write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
if extra:
    involved = [key for key in extra if any(f"[{net}]" in key for net in selected)]
    print("New findings involving requested DDR nets:", "\\n".join(involved)[:7000])
    print("Other finding signatures changed:", sum(extra[key] for key in extra if key not in involved))
assert summary["sourceUnchanged"]
assert not extra, "New native DRC findings"
assert summary["reroutedUnconnectedItems"] == 0, "Native board has disconnected copper"
if os.getenv("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle: handle.write("\nNative copper/connectivity audit:\n\n" + json.dumps(summary, indent=2) + "\n")
