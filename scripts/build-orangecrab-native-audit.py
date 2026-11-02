from pathlib import Path
import collections, hashlib, json, re, shutil
root = Path.cwd()
work = root / "work/native-audit"
source = root / "work/native-source/OrangeCrab.kicad_pcb"
fixture = root / "tests/fixtures/orangecrab-r0.2.1"
raw = source.read_bytes()
assert hashlib.sha256(raw).hexdigest() == "4597f3ac08e21c09253b27ca1b9e26aaf3c3d3e2147b6c0d79c0dc6aa555e201"
text = raw.decode()
circuit = json.loads((fixture / "original.circuit.json").read_text())
requested = json.loads((fixture / "byte0.srj.json").read_text())
report = json.loads((work / "report.json").read_text())
assert report["solved"] and report["connectivity"]["connectedConnectionCount"] == 11
assert report["drc"]["valid"] and not report["drc"]["issues"]
output = json.loads((work / "completed-route.srj.json").read_text())
names = {c["name"] for c in requested["connections"]}
labels = {e["source_net_id"]: e["name"] for e in circuit if e["type"] == "source_net"}
assert labels["source_net_6"] == "RAM_LDQS" and labels["source_net_10"] == "RAM_LDQS_P"
labels.update({"source_net_6": "RAM_LDQS-", "source_net_10": "RAM_LDQS+"})
nets = {name.strip('"'): int(code) for code, name in re.findall(r"^  \(net (\d+) (.*?)\)$", text, re.M)}
codes = {nets[labels[name]] for name in names}
traces = [t for t in output["traces"] if t.get("connection_name") in names]
assert len(traces) == 11
layers = dict(zip(["top", "inner1", "inner2", "inner3", "inner4", "bottom"], ["F.Cu", "In1.Cu", "In2.Cu", "In3.Cu", "In4.Cu", "B.Cu"]))

def clear_cached_fills(text):
    pattern = re.compile(r"(?m)^[ \t]*\((filled_polygon|fill_segments)(?=\s|\))")
    pieces, previous, count = [], 0, 0
    for match in pattern.finditer(text):
        if match.start() < previous:
            continue
        start = text.index("(", match.start(), match.end())
        depth, quoted, escaped, end = 0, False, False, start
        while end < len(text):
            char = text[end]
            if quoted:
                if escaped: escaped = False
                elif char == "\\": escaped = True
                elif char == '"': quoted = False
            elif char == '"': quoted = True
            elif char == "(": depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    end += 1
                    break
            end += 1
        assert depth == 0 and end > start
        pieces.append(text[previous:match.start()])
        previous, count = end, count + 1
    pieces.append(text[previous:])
    assert count > 0
    result = "".join(pieces)
    assert not pattern.search(result)
    return result, count

def position(point):
    return round(point["x"] + 159.91, 6), round(102.95 - point["y"], 6)
def number(value):
    return format(value, ".6f").rstrip("0").rstrip(".") or "0"
retained, removed = [], collections.Counter()
for line in text.splitlines(keepends=True):
    kind = "segments" if line.startswith("  (segment ") else "vias" if line.startswith("  (via ") else None
    net = re.findall(r"\(net (\d+)\)", line) if kind else []
    if kind: assert len(net) == 1 and line.rstrip().endswith(")")
    if kind and int(net[0]) in codes: removed[kind] += 1
    else: retained.append(line)
assert removed == {"vias": 22, "segments": 1215}, removed
records, added = [], collections.Counter()
for trace in traces:
    code = nets[labels[trace["connection_name"]]]
    for point in trace["route"]:
        if point["route_type"] != "via": continue
        x, y = map(number, position(point))
        records.append(f"  (via (at {x} {y}) (size {number(point['via_diameter'])}) (drill {number(point['via_hole_diameter'])}) (layers F.Cu B.Cu) (net {code}))\n")
        added["vias"] += 1
    for a, b in zip(trace["route"], trace["route"][1:]):
        if position(a) == position(b): continue
        wire = a if a["route_type"] == "wire" else b
        assert wire["route_type"] == "wire"
        if a["route_type"] == b["route_type"] == "wire": assert a["layer"] == b["layer"]
        x1, y1 = map(number, position(a))
        x2, y2 = map(number, position(b))
        records.append(f"  (segment (start {x1} {y1}) (end {x2} {y2}) (width {number(wire['width'])}) (layer {layers[wire['layer']]}) (net {code}))\n")
        added["segments"] += 1
assert added["vias"] == 22
unchanged = "".join(retained)
end = unchanged.rfind(")")
derived = unchanged[:end] + "".join(records) + unchanged[end:]
assert derived[:end] + derived[end + sum(map(len, records)):] == unchanged
for label in ["baseline", "rerouted"]:
    target = work / "native" / label
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source.with_suffix(".pro"), target / "OrangeCrab.pro")
    candidate, fill_count = clear_cached_fills(text if label == "baseline" else derived)
    (target / "OrangeCrab.kicad_pcb").write_text(candidate)
    if label == "baseline":
        (source.parent / "unfilled-source.kicad_pcb").write_text(candidate)
audit = {"sourceUnchanged": source.read_bytes() == raw, "removed": dict(removed), "added": dict(added), "unrelatedSourcePcbTextUnchanged": True, "selectedNativeNets": sorted(labels[name] for name in names), "cachedFillBlocksClearedBeforeNativeRefill": fill_count, "authoredZoneOutlinesAndSettingsUnchanged": True}
(work / "native" / "build-audit.json").write_text(json.dumps(audit, indent=2))
print(json.dumps(audit))
