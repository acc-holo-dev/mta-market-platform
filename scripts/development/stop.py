#!/usr/bin/env python3
"""Stop development processes and infrastructure."""
import subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.exit(subprocess.call([sys.executable, str(ROOT / "startup.py"), "stop"], cwd=str(ROOT)))
