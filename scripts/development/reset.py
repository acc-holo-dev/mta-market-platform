#!/usr/bin/env python3
"""Reset the development database: stop, drop volumes, start, re-apply schema.

DESTRUCTIVE: removes all dev data (postgres_data / redis_data volumes).
"""
import subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "infrastructure" / "docker" / "compose" / "development.yml"

def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd))
    return subprocess.run(cmd, cwd=str(ROOT), **kw).returncode

if "--yes" not in sys.argv:
    answer = input("Drop ALL development data (volumes)? type 'yes': ")
    if answer.strip() != "yes":
        sys.exit("aborted")

rc = run(["docker", "compose", "-f", str(COMPOSE), "down", "-v"])
if rc:
    sys.exit(rc)
sys.exit(run([sys.executable, str(ROOT / "startup.py"), "dev"]))
