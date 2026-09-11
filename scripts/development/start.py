#!/usr/bin/env python3
"""Start the full development environment (wrapper over startup.py dev)."""
import subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.exit(subprocess.call([sys.executable, str(ROOT / "startup.py"), "dev"], cwd=str(ROOT)))
