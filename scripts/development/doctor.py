#!/usr/bin/env python3
"""Environment readiness report (startup.py doctor)."""
import subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.exit(subprocess.call([sys.executable, str(ROOT / "startup.py"), "doctor"], cwd=str(ROOT)))
