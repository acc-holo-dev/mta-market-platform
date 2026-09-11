#!/usr/bin/env bash
# Validate every file under contracts/ parses (YAML via python yaml if
# available, JSON via python json). Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import sys, pathlib, json
root = pathlib.Path("contracts")
files = sorted(root.rglob("*"))
checked = 0
try:
    import yaml  # optional
    have_yaml = True
except ImportError:
    have_yaml = False
for f in files:
    if not f.is_file() or f.name.endswith(".md"):
        continue
    text = f.read_text()
    if f.suffix == ".json":
        json.loads(text)
    elif f.suffix in (".yaml", ".yml") and have_yaml:
        import yaml as _y
        _y.safe_load(text)
    checked += 1
print(f"contracts: {checked} files parsed OK" + ("" if have_yaml else " (yaml module missing: YAML syntax not checked)"))
PY
