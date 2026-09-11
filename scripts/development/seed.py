#!/usr/bin/env python3
"""Seed the development database (dev-admin + plan003/plan005 datasets).

Usage: seed.py [--admin-only | --plan003 | --plan005 | --heartbeat]
"""
import subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "site" / "server"
which = [a for a in sys.argv[1:] if a.startswith("--")]
which = which or ["--admin", "--plan003", "--plan005"]

def tsx(script: str, *args: str) -> int:
    return subprocess.run(
        ["pnpm", "exec", "tsx", f"scripts/{script}", *args], cwd=str(SERVER)
    ).returncode

rc = 0
if "--admin" in which or "--admin-only" in which:
    rc |= tsx("dev-admin.ts", "--email", "admin@dev.local", "--username", "admin",
              "--password", "dev-password-123")
if "--plan003" in which:
    rc |= tsx("seed-plan003.ts")
if "--plan005" in which:
    rc |= tsx("seed-plan005.ts")
if "--heartbeat" in which:
    rc |= tsx("dev-heartbeat.ts")
sys.exit(rc)
