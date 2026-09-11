#!/usr/bin/env python3
"""MTA Market Platform — unified development entry point (PLAN-010 §17).

Development convenience ONLY. Production deployments use the existing
stack (ghcr images + infrastructure/docker/compose/production.yml +
scripts/deployments/deploy.sh) — this script never replaces it.

Usage:
  python3 startup.py            # = dev: full development environment
  python3 startup.py dev        # infra -> schema -> backend -> web -> URLs
  python3 startup.py site       # build/type-check the site components
  python3 startup.py module     # configure + build + test the module
  python3 startup.py tests      # unit + integration tests (test DB up)
  python3 startup.py build      # build site and module
  python3 startup.py status     # component status overview
  python3 startup.py stop       # stop dev processes + infrastructure
  python3 startup.py clean      # remove build artifacts
  python3 startup.py doctor     # environment readiness report

Stdlib only (python >= 3.9).
"""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / "runtime" / "pids"
LOGS = ROOT / "logs" / "development"
COMPOSE_DEV = ROOT / "infrastructure" / "docker" / "compose" / "development.yml"
COMPOSE_TESTS = ROOT / "infrastructure" / "docker" / "compose" / "tests.yml"

DEV_SERVICES = {"postgres": ("127.0.0.1", 5432), "redis": ("127.0.0.1", 6379)}
TEST_SERVICES = {"postgres-test": ("127.0.0.1", 5433)}


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, **kw)


def sh_ok(cmd: list[str], **kw) -> bool:
    try:
        return sh(cmd, **kw).returncode == 0
    except FileNotFoundError:
        return False


def port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def have(*tools: str) -> bool:
    return all(shutil.which(t) for t in tools)


def docker_available() -> bool:
    return have("docker") and sh_ok(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def compose(args: list[str], file: Path = COMPOSE_DEV) -> int:
    return sh(["docker", "compose", "-f", str(file), *args]).returncode


def compose_up(file: Path) -> bool:
    if not docker_available():
        print("  ✖ docker is not available — cannot start infrastructure")
        return False
    rc = compose(["up", "-d", "--wait"], file=file)
    if rc != 0:  # --wait unsupported / slow healthchecks: plain up + poll
        compose(["up", "-d"], file=file)
    return True


def wait_ports(targets: dict[str, tuple[str, int]], timeout: float = 60.0) -> dict[str, bool]:
    state = {name: False for name in targets}
    deadline = time.time() + timeout
    while time.time() < deadline:
        for name, (host, port) in targets.items():
            state[name] = port_open(host, port)
        if all(state.values()):
            break
        time.sleep(1.0)
    return state


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def pid_file(name: str) -> Path:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    return RUNTIME / f"{name}.pid"


def spawn_dev(name: str, cmd: list[str]) -> bool:
    LOGS.mkdir(parents=True, exist_ok=True)
    pf = pid_file(name)
    if pf.exists() and pf.read_text().strip().isdigit() and pid_alive(int(pf.read_text().strip())):
        print(f"  • {name}: already running (pid {pf.read_text().strip()})")
        return True
    log = open(LOGS / f"{name}.log", "ab")
    log.write(f"\n=== started {time.strftime('%Y-%m-%d %H:%M:%S')}: {' '.join(cmd)} ===\n".encode())
    proc = subprocess.Popen(
        cmd, cwd=str(ROOT), stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    pf.write_text(str(proc.pid))
    time.sleep(2.0)
    alive = proc.poll() is None or pid_alive(proc.pid)
    print(f"  {'✓' if alive else '✖'} {name}: pid {proc.pid} (log: logs/development/{name}.log)")
    return alive


def stop_pid_file(name: str) -> bool:
    pf = pid_file(name)
    if not pf.exists():
        return False
    raw = pf.read_text().strip()
    if not raw.isdigit():
        pf.unlink(missing_ok=True)
        return False
    pid = int(raw)
    if pid_alive(pid):
        try:
            os.killpg(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            os.kill(pid, signal.SIGTERM)
        for _ in range(20):
            if not pid_alive(pid):
                break
            time.sleep(0.5)
        else:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        print(f"  ✓ stopped {name} (pid {pid})")
    else:
        print(f"  • {name}: stale pid file removed")
    pf.unlink(missing_ok=True)
    return True


def apply_schema(target: str = "mtamarket") -> bool:
    """Apply the prisma contract schema (dev quick path, DATABASE-MIGRATIONS.md)."""
    server = ROOT / "site" / "server"
    env = os.environ.copy()
    dotenv = server / ".env"
    if dotenv.exists() and "DATABASE_URL" not in env:
        for line in dotenv.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env.setdefault(k.strip(), v.strip().strip('"'))
    env.setdefault("DATABASE_URL", f"postgresql://mtamarket:dev_password@127.0.0.1:5432/{target}")
    for cmd in (["npx", "prisma", "contract", "emit"],
                ["npx", "prisma", "db", "update", "--confirm", target]):
        rc = subprocess.run(cmd, cwd=server, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if rc.returncode != 0:
            print(f"  ✖ {' '.join(cmd)} failed:\n{rc.stderr.decode()[-600:]}")
            return False
    print(f"  ✓ database schema applied ({target})")
    return True


def cmd_dev(only: str | None = None) -> int:
    print("== MTA Market development environment ==")
    if not have("node", "pnpm"):
        print("  ✖ node/pnpm missing (see documents/operations/DEVELOPMENT.md)")
        return 2
    if not (ROOT / "node_modules").exists():
        print("  • installing dependencies (pnpm install)...")
        sh(["pnpm", "install"])
    if only in (None, "infra"):
        if compose_up(COMPOSE_DEV):
            state = wait_ports(DEV_SERVICES)
            for name, ok in state.items():
                print(f"  {'✓' if ok else '✖'} {name}")
            if not all(state.values()):
                return 1
        else:
            return 1
    if only in (None, "schema") and not apply_schema():
        return 1
    ok = True
    if only in (None, "backend"):
        ok &= spawn_dev("backend", ["pnpm", "--filter", "@mta-market/server", "dev"])
        if ok and not wait_ports({"api": ("127.0.0.1", 3001)}, timeout=30)["api"]:
            print("  … API not up yet (check logs/development/backend.log)")
    if only in (None, "web"):
        ok &= spawn_dev("web", ["pnpm", "--filter", "@mta-market/web", "dev"])
    print()
    print("  API : http://localhost:3001  (health /health /live /ready /metrics)")
    print("  WEB : http://localhost:3000")
    print("  PG  : localhost:5432 (mtamarket/dev_password)   REDIS : localhost:6379")
    print("  logs: logs/development/{backend,web}.log   stop: python3 startup.py stop")
    return 0 if ok else 1


def cmd_stop() -> int:
    for name in ("web", "backend"):
        stop_pid_file(name)
    if docker_available():
        compose(["stop"], file=COMPOSE_TESTS)
        compose(["stop"], file=COMPOSE_DEV)
        print("  ✓ infrastructure containers stopped (volumes kept)")
    return 0


def cmd_status() -> int:
    checks = []
    for name, (host, port) in {**DEV_SERVICES, **TEST_SERVICES}.items():
        checks.append((name, port_open(host, port)))
    checks.append(("api :3001", port_open("127.0.0.1", 3001)))
    checks.append(("web :3000", port_open("127.0.0.1", 3000)))
    for name, ok in checks:
        print(f"  {'✓' if ok else '✖'} {name}")
    for name in ("backend", "web"):
        pf = pid_file(name)
        if pf.exists() and pf.read_text().strip().isdigit():
            pid = int(pf.read_text().strip())
            print(f"  {'✓' if pid_alive(pid) else '✖'} process {name} (pid {pid})")
    if docker_available():
        out = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}\t{{.Status}}"],
            capture_output=True, text=True)
        for line in out.stdout.splitlines():
            if line.startswith("mta-market"):
                print(f"  • docker: {line}")
    return 0


def cmd_tests() -> int:
    if compose_up(COMPOSE_TESTS):
        wait_ports(TEST_SERVICES)
    rc = sh(["pnpm", "exec", "vitest", "run"]).returncode
    return rc


def cmd_site() -> int:
    rc = sh(["pnpm", "type-check"]).returncode
    if rc == 0:
        rc = sh(["pnpm", "build"]).returncode
    return rc


def cmd_module() -> int:
    if not have("cmake", "ninja", "g++"):
        print("  ✖ cmake/ninja/g++ missing (see documents/module/BUILD.md)")
        return 2
    if sh(["cmake", "--preset", "linux-gcc", "-S", "module"]).returncode:
        return 1
    if sh(["cmake", "--build", "--preset", "linux-gcc", "-S", "module"]).returncode:
        return 1
    return sh(["ctest", "--preset", "linux-gcc", "--test-dir", "module", "--output-on-failure"]).returncode


def cmd_build() -> int:
    return cmd_site() if (rc := cmd_site()) else cmd_module()


def cmd_clean() -> int:
    return sh(["bash", "scripts/maintenance/cleanup.sh"]).returncode


def cmd_doctor() -> int:
    rows: list[tuple[str, bool, str]] = []
    rows.append(("python >= 3.9", sys.version_info >= (3, 9), sys.version.split()[0]))
    rows.append(("node", have("node"), shutil.which("node") or ""))
    rows.append(("pnpm", have("pnpm"), shutil.which("pnpm") or ""))
    rows.append(("docker", docker_available(), shutil.which("docker") or ""))
    rows.append(("cmake >= 3.27", have("cmake"), shutil.which("cmake") or "install: pip install --user cmake"))
    rows.append(("ninja", have("ninja"), shutil.which("ninja") or "install: pip install --user ninja"))
    rows.append(("g++", have("g++"), shutil.which("g++") or ""))
    deps = (ROOT / "node_modules").exists()
    rows.append(("workspace deps installed", deps, "" if deps else "run: pnpm install"))
    env_dev = (ROOT / "site" / "server" / ".env").exists()
    rows.append(("site/server/.env (untracked, local)", env_dev, "" if env_dev else "copy from site/server/.env.example"))
    for name, (host, port) in {**DEV_SERVICES, **TEST_SERVICES}.items():
        rows.append((f"{name} :{port}", port_open(host, port), ""))
    width = max(len(r[0]) for r in rows)
    failed = 0
    for name, ok, note in rows:
        mark = "PASS" if ok else "FAIL"
        failed += 0 if ok else 1
        print(f"  [{mark}] {name.ljust(width)}  {note}")
    if failed:
        print(f"\n  {failed} check(s) failed — see documents/operations/DEVELOPMENT.md")
    else:
        print("\n  environment ready. start: python3 startup.py dev")
    return 0 if failed == 0 else 1


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else "dev"
    commands = {
        "dev": lambda: cmd_dev(None),
        "site": cmd_site,
        "module": cmd_module,
        "tests": cmd_tests,
        "build": cmd_build,
        "status": cmd_status,
        "stop": cmd_stop,
        "clean": cmd_clean,
        "doctor": cmd_doctor,
    }
    if arg not in commands:
        print(__doc__)
        return 2
    return commands[arg]()


if __name__ == "__main__":
    sys.exit(main())
