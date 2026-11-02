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

def sexpr_end(text, start):
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
            if depth == 0: return end + 1
        end += 1
    raise ValueError("Unbalanced cached source expression")

def clear_cached_fills(text):
    pattern = re.compile(r"(?m)^[ \t]*\((filled_polygon|fill_segments)(?=\s|\))")
    pieces, previous, count = [], 0, 0
    for match in pattern.finditer(text):
        if match.start() < previous: continue
        start = text.index("(", match.start(), match.end())
        end = sexpr_end(text, start)
        pieces.append(text[previous:match.start()])
        previous, count = end, count + 1
    pieces.append(text[previous:])
    assert count > 0
    result = "".join(pieces)
    assert not pattern.search(result)
    pieces, previous, states = [], 0, 0
    for match in re.finditer(r"(?m)^  \(zone(?=\s|\))", result):
        start = match.start()
        end = sexpr_end(result, result.index("(", start, match.end()))
        zone, changed = re.subn(r"(?m)^([ \t]*\(fill)\s+yes\b", r"\1", result[start:end], count=1)
        pieces.append(result[previous:start] + zone)
        previous, states = end, states + changed
    pieces.append(result[previous:])
    assert states > 0
    return "".join(pieces), count, states


def normalize_nil_zone_ids(text):
    used = {int(stamp, 16) for stamp in re.findall(r"\(tstamp ([0-9a-fA-F]+)\)", text)}
    pieces, previous, replacements = [], 0, []
    next_stamp = 0xF0000000
    for index, match in enumerate(re.finditer(r"(?m)^  \(zone(?=\s|\))", text)):
        start = match.start()
        end = sexpr_end(text, text.index("(", start, match.end()))
        zone = text[start:end]
        if re.search(r"\(tstamp 0\)", zone):
            while next_stamp in used: next_stamp += 1
            stamp = format(next_stamp, "08X")
            normalized, count = re.subn(r"\(tstamp 0\)", f"(tstamp {stamp})", zone, count=1)
            assert count == 1
            assert normalized.replace(f"(tstamp {stamp})", "(tstamp 0)", 1) == zone
            zone = normalized
            replacements.append({"zoneIndex": index, "originalTimestamp": "0", "auditTimestamp": stamp})
            used.add(next_stamp)
            next_stamp += 1
        pieces.append(text[previous:start] + zone)
        previous = end
    pieces.append(text[previous:])
    return "".join(pieces), replacements

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
    candidate, fill_count, state_count = clear_cached_fills(text if label == "baseline" else derived)
    candidate, zone_id_replacements = normalize_nil_zone_ids(candidate)
    (target / "OrangeCrab.kicad_pcb").write_text(candidate)
    if label == "baseline":
        (source.parent / "unfilled-source.kicad_pcb").write_text(candidate)
audit = {"sourceUnchanged": source.read_bytes() == raw, "removed": dict(removed), "added": dict(added), "unrelatedSourcePcbTextUnchanged": True, "selectedNativeNets": sorted(labels[name] for name in names), "cachedFillBlocksClearedBeforeNativeRefill": fill_count, "nativeFilledStatusFlagsReset": state_count, "authoredZoneOutlinesAndSettingsUnchanged": True, "auditOnlyNilZoneIdReplacements": zone_id_replacements}
(work / "native" / "build-audit.json").write_text(json.dumps(audit, indent=2))
print(json.dumps(audit))
