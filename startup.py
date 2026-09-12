#!/usr/bin/env python3
"""MTA Market Platform — canonical operational entry point (PLAN-017 §13).

ONE local operational model:

  python startup.py            -> full local development environment (= dev)
  python startup.py dev [infra|schema|backend|web]
  python startup.py release    -> production-like local stack + smoke
  python startup.py test [unit|integration|e2e|smoke|affected|release]
  python startup.py build      -> build site and native module
  python startup.py module     -> configure + build + test the native module
  python startup.py db [apply|seed|reset|status]
  python startup.py status     -> one compact service table
  python startup.py logs [name] [--follow]
  python startup.py stop       -> stop app processes + infrastructure (volumes kept)
  python startup.py clean [--destructive] [--yes]
  python startup.py doctor     -> environment diagnosis

Design rules:
  - Configuration comes from config/ (environments + application); this
    script exports the derived environment variables for spawned services.
    Secrets never live in config/ and are never printed by this script.
  - Runtime state lives in temp/runtime/pids; dev logs in logs/development.
  - `clean` never removes production data (DB volumes, uploads, secrets)
    without --destructive and an explicit confirmation.
  - Production deployments keep using the existing stack (ghcr images +
    infrastructure/docker/compose/production.yml + deploy scripts); this
    script never replaces it. `release` is a local production-like
    rehearsal with ephemeral secrets only.
  - The native module currently has no supported Windows build; doctor
    reports that honestly (documents/architecture/MODULE.md).

Stdlib only (python >= 3.10).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
TEMP = ROOT / "temp"
PID_DIR = TEMP / "runtime" / "pids"
LOG_DIR = ROOT / "logs" / "development"
CONFIG_DIR = ROOT / "config"
SERVER_DIR = ROOT / "site" / "server"
WEB_DIR = ROOT / "site" / "web"
COMPOSE_DIR = ROOT / "infrastructure" / "docker" / "compose"
COMPOSE_DEV = COMPOSE_DIR / "development.yml"
COMPOSE_TESTS = COMPOSE_DIR / "tests.yml"
COMPOSE_STAGING = COMPOSE_DIR / "staging.yml"
COMPOSE_PROD = COMPOSE_DIR / "production.yml"

DEV_PROJECT = "mta-market-dev"
TESTS_PROJECT = "mta-market-tests"
RELEASE_PREFIX = "mta-market-release"

# Operator-provided PORT (captured before derive_environment exports the API
# port into os.environ; the web service must not inherit the backend port).
OPERATOR_PORT = os.environ.get("PORT")

IS_WINDOWS = os.name == "nt"

OK, FAIL, SKIP, INFO = "[ok]", "[FAIL]", "[skip]", "[..]"


def out(message: str = "") -> None:
    print(message, flush=True)


def mark(ok: bool) -> str:
    return OK if ok else FAIL


# ---------------------------------------------------------------------------
# Minimal YAML subset parser (same semantics as site/server/src/config/loader.ts).
# Supports: comments, nested maps by indentation, inline [a, b] arrays,
# quoted/plain scalars, ints, floats, booleans, null. Anything else is a hard
# error — malformed configuration must be rejected, not guessed.
# ---------------------------------------------------------------------------

def _strip_comment(line: str) -> str:
    in_quote: str | None = None
    for i, ch in enumerate(line):
        if in_quote:
            if ch == in_quote:
                in_quote = None
        elif ch in ('"', "'"):
            in_quote = ch
        elif ch == "#":
            return line[:i]
    return line


def parse_scalar(raw: str) -> object:
    t = raw.strip()
    if t in ("", "~", "null"):
        return None
    if t == "true":
        return True
    if t == "false":
        return False
    if t == "{}":
        return {}
    if len(t) >= 2 and t[0] == t[-1] and t[0] in ('"', "'"):
        return t[1:-1]
    if re.fullmatch(r"-?\d+", t):
        return int(t)
    if re.fullmatch(r"-?\d+\.\d+", t):
        return float(t)
    if t.startswith("[") and t.endswith("]"):
        inner = t[1:-1].strip()
        return [] if not inner else [parse_scalar(p) for p in inner.split(",")]
    return t


def parse_yaml(text: str, file: str = "<yaml>") -> dict:
    lines: list[tuple[int, str, int]] = []  # (indent, content, line_no)
    for no, raw in enumerate(text.splitlines(), start=1):
        line = _strip_comment(raw)
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        lines.append((indent, line.strip(), no))

    def parse_block(start: int, indent: int) -> tuple[dict, int]:
        result: dict = {}
        i = start
        while i < len(lines):
            block_indent, content, line_no = lines[i]
            if block_indent < indent:
                break
            if block_indent > indent:
                raise ValueError(f"{file}:{line_no}: unexpected indentation")
            match = re.match(r"^([^:]+):\s*(.*)$", content)
            if not match:
                raise ValueError(f'{file}:{line_no}: expected \'key: value\', got "{content}"')
            key = match.group(1).strip().strip('"').strip("'")
            raw_value = match.group(2).strip()
            i += 1
            if raw_value:
                result[key] = parse_scalar(raw_value)
            elif i < len(lines) and lines[i][0] > block_indent:
                result[key], i = parse_block(i, lines[i][0])
            else:
                result[key] = None
        return result, i

    if not lines:
        return {}
    value, _ = parse_block(0, lines[0][0])
    return value


# ---------------------------------------------------------------------------
# Tiny JSON-Schema subset validator (covers config/schemas/*.json:
# type/enum/const/required/properties/additionalProperties/items/minimum/
# maximum/$ref/$defs).
# ---------------------------------------------------------------------------

def validate_against_schema(value: object, schema: dict, root: dict | None = None) -> list[str]:
    root = root or schema
    errors: list[str] = []

    if "$ref" in schema:
        name = schema["$ref"].replace("#/$defs/", "")
        resolved = (root.get("$defs") or {}).get(name)
        if not resolved:
            return [f"unresolvable $ref {schema['$ref']}"]
        return validate_against_schema(value, resolved, root)

    if "const" in schema and value != schema["const"]:
        errors.append(f"expected constant {schema['const']!r}, got {value!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"value {value!r} not in enum {schema['enum']}")

    if isinstance(value, bool):
        actual = "boolean"
    elif isinstance(value, int):
        actual = "integer"
    elif isinstance(value, float):
        actual = "number"
    elif isinstance(value, str):
        actual = "string"
    elif isinstance(value, list):
        actual = "array"
    elif isinstance(value, dict):
        actual = "object"
    elif value is None:
        actual = "null"
    else:
        actual = "unknown"

    expected = schema.get("type")
    if expected:
        expected_list = expected if isinstance(expected, list) else [expected]
        if actual == "number" and "integer" in expected_list and isinstance(value, int):
            pass
        elif actual not in expected_list:
            errors.append(f"expected type {'|'.join(expected_list)}, got {actual}")
            return errors

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"value {value} < minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"value {value} > maximum {schema['maximum']}")

    if isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            for message in validate_against_schema(item, schema["items"], root):
                errors.append(f"[{index}] {message}")

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f'missing required key "{key}"')
        for key, sub in properties.items():
            if key in value:
                errors.extend(f"{key}: {m}" for m in validate_against_schema(value[key], sub, root))
        additional = schema.get("additionalProperties", True)
        if additional is False:
            for key in value:
                if key not in properties:
                    errors.append(f'unexpected key "{key}"')
        elif isinstance(additional, dict):
            for key, item in value.items():
                if key in properties:
                    continue
                errors.extend(f"{key}: {m}" for m in validate_against_schema(item, additional, root))
    return errors


# ---------------------------------------------------------------------------
# Configuration loading.
# ---------------------------------------------------------------------------

def load_schema_file(name: str) -> dict:
    return json.loads((CONFIG_DIR / "schemas" / name).read_text(encoding="utf-8"))


def load_env_config(environment: str) -> dict:
    path = CONFIG_DIR / "environments" / f"{environment}.yaml"
    if not path.exists():
        raise SystemExit(f"{FAIL} config/environments/{environment}.yaml not found")
    data = parse_yaml(path.read_text(encoding="utf-8"), str(path.relative_to(ROOT)))
    errors = validate_against_schema(data, load_schema_file("environment.schema.json"))
    if errors:
        raise SystemExit(f"{FAIL} {path.name} failed schema validation: " + "; ".join(errors[:8]))
    return data


def load_application_config() -> tuple[dict, list[str]]:
    issues: list[str] = []
    collected: dict = {}
    schema = load_schema_file("application.schema.json")
    for name in ("features", "limits", "logging"):
        path = CONFIG_DIR / "application" / f"{name}.yaml"
        try:
            data = parse_yaml(path.read_text(encoding="utf-8"), str(path.relative_to(ROOT)))
            errors = validate_against_schema(data, schema)
            if errors:
                issues.append(f"{name}.yaml: schema violations: " + "; ".join(errors[:8]))
                continue
            collected[name] = data
        except (OSError, ValueError) as error:
            issues.append(f"{name}.yaml: malformed ({error})")
    return collected, issues


def validate_all_config() -> list[str]:
    issues: list[str] = []
    for name in ENVIRONMENTS:
        path = CONFIG_DIR / "environments" / f"{name}.yaml"
        if not path.exists():
            issues.append(f"environments/{name}.yaml missing")
            continue
        try:
            data = parse_yaml(path.read_text(encoding="utf-8"), str(path.relative_to(ROOT)))
            errors = validate_against_schema(data, load_schema_file("environment.schema.json"))
            if errors:
                issues.append(f"environments/{name}.yaml: " + "; ".join(errors[:6]))
        except ValueError as error:
            issues.append(f"environments/{name}.yaml: malformed ({error})")
    _, app_issues = load_application_config()
    issues.extend(app_issues)
    return issues


def cfg_get(data: dict, path: tuple[str, ...], default: object) -> object:
    value: object = data
    for key in path:
        if not isinstance(value, dict):
            return default
        value = value.get(key, default)
    return value


def cfg_int(data: dict, path: tuple[str, ...], default: int) -> int:
    value = cfg_get(data, path, default)
    return value if isinstance(value, int) else default


def cfg_str(data: dict, path: tuple[str, ...], default: str) -> str:
    value = cfg_get(data, path, default)
    return value if isinstance(value, str) else default


def load_limits(environment: str) -> dict[str, int]:
    path = CONFIG_DIR / "application" / "limits.yaml"
    if not path.exists():
        return {}
    try:
        data = parse_yaml(path.read_text(encoding="utf-8"), "config/application/limits.yaml")
    except ValueError as error:
        out(f"  {FAIL} limits.yaml rejected: {error}")
        return {}
    columns = data.get("rateLimits") if isinstance(data.get("rateLimits"), dict) else {}
    limits: dict[str, int] = {}
    for name, column in columns.items():
        if isinstance(column, dict):
            value = column.get(environment, column.get("development"))
            if isinstance(value, int):
                limits[name] = value
    return limits


def load_logging(environment: str) -> tuple[str, str]:
    path = CONFIG_DIR / "application" / "logging.yaml"
    if not path.exists():
        return ("pretty", "info")
    try:
        data = parse_yaml(path.read_text(encoding="utf-8"), "config/application/logging.yaml")
    except ValueError as error:
        out(f"  {FAIL} logging.yaml rejected: {error}")
        return ("pretty", "info")
    section = data.get("logging") if isinstance(data.get("logging"), dict) else {}
    fmt = section.get("format") if isinstance(section.get("format"), dict) else {}
    level = section.get("level") if isinstance(section.get("level"), dict) else {}
    fmt_value = fmt.get(environment)
    level_value = level.get(environment)
    return (
        fmt_value if isinstance(fmt_value, str) else "pretty",
        level_value if isinstance(level_value, str) else "info",
    )


def database_url(data: dict, environment: str) -> str:
    host = cfg_str(data, ("database", "host"), "127.0.0.1")
    port = cfg_int(data, ("database", "port"), 5432)
    db = cfg_str(data, ("database", "db"), "mtamarket")
    user = cfg_str(data, ("database", "user"), "mtamarket")
    password_env = cfg_str(data, ("database", "passwordEnv"), "POSTGRES_PASSWORD")
    password = os.environ.get(password_env) or "dev_password"  # documented non-secret local credential
    if environment == "production" and not os.environ.get(password_env):
        raise SystemExit(f"{FAIL} {environment}: {password_env} must be provided by the deployment environment")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def derive_environment(data: dict, environment: str = "development") -> dict[str, str]:
    """Build the service environment from canonical config (config-owned keys only).

    Values already present in os.environ are preserved (deployment env wins).
    Secret material is never generated here; it comes from .env files or the
    deployment environment. See cmd_release for the local-release exception.
    """
    api_port = cfg_int(data, ("api", "port"), 3001)
    web_port = cfg_int(data, ("web", "port"), 3000)
    api_base = cfg_str(data, ("api", "baseUrl"), f"http://localhost:{api_port}")
    frontend_url = cfg_str(data, ("api", "frontendUrl"), f"http://localhost:{web_port}")
    redis_url = cfg_str(data, ("redis", "url"), "redis://127.0.0.1:6379")
    api_section = data.get("api") if isinstance(data.get("api"), dict) else {}
    cors_origins = api_section.get("corsOrigins") or [frontend_url]
    log_format, log_level = load_logging(environment)
    limits = load_limits(environment)
    node_env = cfg_str(data, ("api", "nodeEnv"), "development")

    env: dict[str, str] = {}

    def setdefault(key: str, value: str) -> None:
        env[key] = os.environ.get(key) or value

    setdefault("PORT", str(api_port))
    setdefault("NODE_ENV", node_env)
    setdefault("DATABASE_URL", database_url(data, environment))
    setdefault("REDIS_URL", redis_url)
    setdefault("FRONTEND_URL", frontend_url)
    setdefault("BASE_URL", api_base)
    setdefault("CORS_ORIGINS", ",".join(cors_origins))
    setdefault("COOKIE_SAMESITE", cfg_str(data, ("api", "cookieSameSite"), "lax"))
    setdefault("TRUST_PROXY", "true" if api_section.get("trustProxy", True) else "false")
    setdefault("LOG_FORMAT", log_format)
    setdefault("LOG_LEVEL", log_level)
    env.setdefault("S3_ENABLED", "false" if environment == "development" else "true")
    env.setdefault("EMAIL_ENABLED", "false" if environment in ("development", "test") else "true")
    env.setdefault("UPLOAD_DIR", cfg_str(data, ("storage", "uploadDir"), "./uploads"))
    jobs = data.get("jobs") if isinstance(data.get("jobs"), dict) else {}
    env.setdefault("RECONCILIATION_ENABLED", "true" if jobs.get("reconciliationEnabled", True) else "false")
    env.setdefault("SERVER_MONITORING_ENABLED", "true" if jobs.get("serverMonitoringEnabled", True) else "false")
    for name, value in limits.items():
        env.setdefault(f"{name.upper()}_RATE_LIMIT_MAX", str(value))
    return env


def derive_web_env(data: dict) -> dict[str, str]:
    api_port = cfg_int(data, ("api", "port"), 3001)
    web_port = cfg_int(data, ("web", "port"), 3000)
    public_api = cfg_str(data, ("web", "publicApiUrl"), f"http://localhost:{api_port}")
    env: dict[str, str] = {}
    env["PORT"] = OPERATOR_PORT or str(web_port)
    env["NEXT_PUBLIC_API_URL"] = os.environ.get("NEXT_PUBLIC_API_URL") or public_api
    return env


# ---------------------------------------------------------------------------
# Service registry and status (PLAN-017 §19).
# ---------------------------------------------------------------------------

class ServiceStatus:
    def __init__(self, name: str, state: str, detail: str = "") -> None:
        self.name = name
        self.state = state  # RUNNING | STOPPED | DEGRADED | MISSING
        self.detail = detail


def collect_status(data: dict) -> list[ServiceStatus]:
    api_port = cfg_int(data, ("api", "port"), 3001)
    web_port = cfg_int(data, ("web", "port"), 3000)
    pg_port = cfg_int(data, ("database", "port"), 5432)
    redis_url = cfg_str(data, ("redis", "url"), "redis://127.0.0.1:6379")
    redis_match = re.match(r"^[a-z]+://[^/]*:(\d+)", redis_url)
    redis_port = int(redis_match.group(1)) if redis_match else 6379
    test_port = cfg_int(data, ("database", "test", "hostPort"), 5433)

    def web_status() -> ServiceStatus:
        if port_open("127.0.0.1", web_port):
            state = "RUNNING" if http_ok(f"http://127.0.0.1:{web_port}") else "DEGRADED"
            return ServiceStatus("WEB", state, f":{web_port}")
        return ServiceStatus("WEB", "STOPPED", f":{web_port}")

    def api_status() -> ServiceStatus:
        if port_open("127.0.0.1", api_port):
            healthy = http_ok(f"http://127.0.0.1:{api_port}/health")
            ready = http_ok(f"http://127.0.0.1:{api_port}/ready")
            state = "RUNNING" if healthy and ready else "DEGRADED"
            return ServiceStatus("API", state, f":{api_port} (/health /live /ready /metrics)")
        return ServiceStatus("API", "STOPPED", f":{api_port}")

    def worker_status() -> ServiceStatus:
        pid = read_pid("worker")
        if pid and pid_alive(pid):
            return ServiceStatus("WORKER", "RUNNING", f"pid {pid}")
        return ServiceStatus("WORKER", "MISSING", "worker runtime not configured")

    def container_status(name: str, label: str, port: int) -> ServiceStatus:
        if container_running(name):
            health = container_health(name) or "unknown"
            state = "RUNNING" if health == "healthy" else "DEGRADED"
            return ServiceStatus(label, state, f"container {name} :{port}")
        return ServiceStatus(label, "STOPPED", f":{port}")

    def module_status() -> ServiceStatus:
        so = ROOT / "module" / "build" / "linux-gcc" / "base.so"
        dll = next(iter((ROOT / "module" / "build").glob("*/base.dll")), None) if (ROOT / "module" / "build").exists() else None
        artifact = so if so.exists() else dll
        if artifact:
            return ServiceStatus("MODULE", "RUNNING", f"build artifact: {artifact.name}")
        return ServiceStatus("MODULE", "MISSING", "not built on this host")

    def test_env_status() -> ServiceStatus:
        if port_open("127.0.0.1", test_port):
            return ServiceStatus("TEST ENV", "RUNNING", f"postgres-test :{test_port}")
        return ServiceStatus("TEST ENV", "STOPPED", f":{test_port} (started on demand)")

    return [
        web_status(),
        api_status(),
        worker_status(),
        container_status("mta-market-postgres", "POSTGRES", pg_port),
        container_status("mta-market-redis", "REDIS", redis_port),
        module_status(),
        test_env_status(),
    ]


def cmd_status() -> int:
    data = load_env_config("development")
    rows = collect_status(data)
    out("== MTA Market services ==")
    width = max(len(row.name) for row in rows)
    for row in rows:
        out(f"  {row.name.ljust(9)} {row.state.ljust(9)} {row.detail}")
    return 0


# ---------------------------------------------------------------------------
# Tool / process / network helpers (cross-platform).
# ---------------------------------------------------------------------------

def sh(cmd: list[str], **kw: object) -> subprocess.CompletedProcess:
    # PLAN-020 N-002/U-001: callers may override cwd (cmd_module runs in
    # module/); ROOT stays the default working directory.
    kw.setdefault("cwd", str(ROOT))
    return subprocess.run([str(c) for c in cmd], **kw)


def sh_ok(cmd: list[str], **kw: object) -> bool:
    try:
        return sh(cmd, **kw).returncode == 0
    except (FileNotFoundError, OSError):
        return False


def exe(name: str) -> str:
    """Resolve an executable, preferring .cmd shims on Windows (pnpm/npx)."""
    found = shutil.which(name) or (shutil.which(name + ".cmd") if IS_WINDOWS else None)
    return found or name


def have(*tools: str) -> bool:
    return all(shutil.which(t) or (IS_WINDOWS and shutil.which(t + ".cmd")) for t in tools)


def port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def http_ok(url: str, timeout: float = 3.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, OSError):
        return False


def docker_available() -> bool:
    return have("docker") and sh_ok(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def compose(args: list[str], file: Path = COMPOSE_DEV, project: str | None = None,
            env_file: Path | None = None) -> int:
    cmd = ["docker", "compose"]
    if env_file:
        cmd += ["--env-file", str(env_file)]
    if project:
        cmd += ["-p", project]
    cmd += ["-f", str(file), *args]
    return sh(cmd).returncode


def container_running(name: str) -> bool:
    result = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", name],
                            capture_output=True, text=True)
    return result.returncode == 0 and result.stdout.strip() == "true"


def container_health(name: str) -> str | None:
    result = subprocess.run(["docker", "inspect", "--format", "{{.State.Health.Status}}", name],
                            capture_output=True, text=True)
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def docker_exec(name: str, cmd: list[str]) -> tuple[bool, str]:
    result = subprocess.run(["docker", "exec", name, *cmd], capture_output=True, text=True)
    return result.returncode == 0, (result.stdout + result.stderr).strip()


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if IS_WINDOWS:
        import ctypes
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if handle:
            kernel32.CloseHandle(handle)
            return True
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def read_pid(name: str) -> int | None:
    pf = PID_DIR / f"{name}.pid"
    if not pf.exists():
        return None
    raw = pf.read_text(encoding="utf-8").strip()
    return int(raw) if raw.isdigit() else None


def spawn_detached(name: str, cmd: list[str], env: dict[str, str] | None = None) -> bool:
    """Start a long-running service detached, with a PID file and a dev log."""
    PID_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    pf = PID_DIR / f"{name}.pid"
    if pf.exists():
        existing = pf.read_text(encoding="utf-8").strip()
        if existing.isdigit() and pid_alive(int(existing)):
            out(f"  {INFO} {name}: already running (pid {existing})")
            return True
        pf.unlink(missing_ok=True)
    log = open(LOG_DIR / f"{name}.log", "ab")
    log.write(f"\n=== started {time.strftime('%Y-%m-%d %H:%M:%S')}: {' '.join(cmd)} ===\n".encode())
    kwargs: dict = {}
    if IS_WINDOWS:
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen(
            [str(c) for c in cmd], cwd=str(ROOT), stdout=log, stderr=subprocess.STDOUT,
            env={**os.environ, **(env or {})}, **kwargs)
    except FileNotFoundError as error:
        out(f"  {FAIL} {name}: cannot start ({error})")
        return False
    pf.write_text(str(proc.pid))
    time.sleep(1.5)
    alive = proc.poll() is None or pid_alive(proc.pid)
    out(f"  {mark(alive)} {name}: pid {proc.pid} (log: logs/development/{name}.log)")
    return alive


def stop_pid(name: str) -> bool:
    pf = PID_DIR / f"{name}.pid"
    if not pf.exists():
        return False
    raw = pf.read_text(encoding="utf-8").strip()
    if not raw.isdigit():
        pf.unlink(missing_ok=True)
        return False
    pid = int(raw)
    if pid_alive(pid):
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            import signal
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    pass
            for _ in range(20):
                if not pid_alive(pid):
                    break
                time.sleep(0.5)
            else:
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass
        out(f"  {OK} stopped {name} (pid {pid})")
    else:
        out(f"  {SKIP} {name}: stale pid file removed")
    pf.unlink(missing_ok=True)
    return True


def wait_for_http(url: str, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if http_ok(url):
            return True
        time.sleep(1.0)
    return False


def tail_file(path: Path, lines: int = 60) -> list[str]:
    if not path.exists():
        return []
    max_bytes = 256 * 1024
    size = path.stat().st_size
    with open(path, "rb") as handle:
        if size > max_bytes:
            handle.seek(-max_bytes, os.SEEK_END)
        data = handle.read()
    text_lines = data.decode("utf-8", errors="replace").splitlines()
    return text_lines[-lines:]


def wait_ports(targets: dict[str, int], timeout: float = 60.0) -> dict[str, bool]:
    state = {name: False for name in targets}
    deadline = time.time() + timeout
    while time.time() < deadline:
        for name, port in targets.items():
            state[name] = port_open("127.0.0.1", port)
        if all(state.values()):
            break
        time.sleep(1.0)
    return state


# ---------------------------------------------------------------------------
# Infrastructure.
# ---------------------------------------------------------------------------

def ensure_dev_infra(data: dict) -> bool:
    """Ensure development infrastructure (postgres + redis) is healthy."""
    if not docker_available():
        out(f"  {FAIL} docker is not available — cannot start infrastructure")
        return False
    pg_port = cfg_int(data, ("database", "port"), 5432)
    redis_port = 6379
    pg_name, redis_name = "mta-market-postgres", "mta-market-redis"
    # Transitional bridge: containers with these canonical names may exist
    # from the legacy mta-market-site stack. Reuse them when healthy — the
    # service contract (ports, credentials) is identical. The monorepo
    # compose files own them once the legacy stack is gone.
    if container_running(pg_name) and container_running(redis_name):
        healths = [container_health(pg_name), container_health(redis_name)]
        if all(h == "healthy" for h in healths):
            out(f"  {OK} postgres + redis already running (reused)")
            return True
    if compose(["up", "-d", "--wait"], file=COMPOSE_DEV, project=DEV_PROJECT) != 0:
        compose(["up", "-d"], file=COMPOSE_DEV, project=DEV_PROJECT)
    state = {name: port_open("127.0.0.1", port)
             for name, port in (("postgres", pg_port), ("redis", redis_port))}
    for name, ok in state.items():
        out(f"  {mark(ok)} {name}")
    return all(state.values())


def dotenv_exists() -> bool:
    return (SERVER_DIR / ".env").exists()


def apply_schema(target: str = "mtamarket") -> bool:
    """Apply the prisma contract schema (dev quick path, DATABASE-MIGRATIONS.md)."""
    env = os.environ.copy()
    if dotenv_exists() and "DATABASE_URL" not in env:
        for line in (SERVER_DIR / ".env").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                env.setdefault(key.strip(), value.strip().strip('"'))
    data = load_env_config("development")
    env.setdefault("DATABASE_URL", database_url(data, "development"))
    for cmd in ([exe("npx"), "prisma", "contract", "emit"],
                [exe("npx"), "prisma", "db", "update", "--confirm", target]):
        result = subprocess.run(cmd, cwd=str(SERVER_DIR), env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if result.returncode != 0:
            out(f"  {FAIL} {' '.join(str(c) for c in cmd)} failed:\n{result.stderr.decode(errors='replace')[-600:]}")
            return False
    out(f"  {OK} database schema applied")
    return True


SEED_SCRIPTS = {
    "admin": "scripts/dev-admin.ts",
    "plan003": "scripts/seed-plan003.ts",
    "plan005": "scripts/seed-plan005.ts",
    "services": "scripts/seed-services.ts",
    "heartbeat": "scripts/dev-heartbeat.ts",
}


def seed_database(targets: list[str]) -> int:
    env = os.environ.copy()
    env.setdefault("DATABASE_URL", database_url(load_env_config("development"), "development"))
    rc = 0
    for target in targets:
        script = SEED_SCRIPTS.get(target)
        if not script:
            out(f"  {FAIL} unknown seed target: {target}")
            return 2
        out(f"  {INFO} seeding {target} ...")
        result = subprocess.run([exe("pnpm"), "exec", "tsx", script], cwd=str(SERVER_DIR), env=env)
        rc |= result.returncode
    return rc


# ---------------------------------------------------------------------------
# Commands.
# ---------------------------------------------------------------------------

def cmd_dev(only: str | None = None) -> int:
    out("== MTA Market development environment ==")
    data = load_env_config("development")
    api_port = cfg_int(data, ("api", "port"), 3001)
    web_port = cfg_int(data, ("web", "port"), 3000)

    if not have("node", "pnpm"):
        out(f"  {FAIL} node/pnpm missing (see documents/architecture/TOOLCHAIN.md)")
        return 2
    if not (ROOT / "node_modules").exists():
        out(f"  {INFO} installing dependencies (pnpm install)...")
        sh([exe("pnpm"), "install"])

    if only in (None, "infra", "worker") and not ensure_dev_infra(data):
        return 1
    if only in (None, "schema") and not apply_schema():
        return 1

    ok = True
    if only in (None, "backend", "worker"):
        env = derive_environment(data, "development")
        for key, value in env.items():
            os.environ[key] = value
        if only in (None, "backend"):
            ok &= spawn_detached("backend", [exe("pnpm"), "--filter", "@mta-market/server", "dev"])
            if ok and not wait_for_http(f"http://127.0.0.1:{api_port}/health", timeout=60):
                # PLAN-020 N-004: a spawned-but-unhealthy backend is a failure
                # ("dev" must not exit 0 with a dead service).
                ok = False
                out(f"  {FAIL} API not healthy after 60s (check logs/development/backend.log)")
        # PLAN-019 H: the worker runtime owns the outbox consumer and the
        # periodic schedulers (reconciliation, server monitoring, demo and
        # price-alert sweeps). Spawned with the same derived environment as
        # the backend; a pre-wave-6 checkout without src/worker is honestly
        # skipped, not an error.
        worker_entry = SERVER_DIR / "src" / "worker" / "index.ts"
        if only == "worker" and not worker_entry.exists():
            out(f"  {SKIP} worker: {worker_entry.relative_to(ROOT)} not present")
        elif worker_entry.exists() and only in (None, "worker"):
            ok &= spawn_detached(
                "worker",
                [exe("pnpm"), "--filter", "@mta-market/server", "exec", "tsx", "src/worker/index.ts"],
            )
    if only in (None, "web"):
        env = derive_web_env(data)
        for key, value in env.items():
            os.environ[key] = value
        ok &= spawn_detached("web", [exe("pnpm"), "--filter", "@mta-market/web", "dev"])
        if ok and not wait_for_http(f"http://127.0.0.1:{web_port}", timeout=60):
            # PLAN-020 N-004: spawned-but-dead web is a failure, not a note.
            ok = False
            out(f"  {FAIL} web not answering after 60s (check logs/development/web.log)")

    out()
    out(f"  API : http://localhost:{api_port}  (health /health /live /ready /metrics)")
    out(f"  WEB : http://localhost:{web_port}")
    if (SERVER_DIR / "src" / "worker" / "index.ts").exists():
        out("  WORKER: outbox consumer + schedulers (python startup.py dev worker)")
    out("  PG  : localhost:5432 (mtamarket)   REDIS : localhost:6379")
    out("  logs: logs/development/{backend,worker,web}.log   stop: python startup.py stop")
    return 0 if ok else 1


def generate_ephemeral_secrets() -> dict[str, str]:
    """Local-release-only ephemeral secrets (never used for real deployments)."""
    node_code = (
        "const c=require('crypto');"
        "const ed=()=>c.generateKeyPairSync('ed25519',"
        "{privateKeyEncoding:{type:'pkcs8',format:'der'},"
        "publicKeyEncoding:{type:'spki',format:'der'}}).privateKey.toString('base64');"
        "process.stdout.write(JSON.stringify({"
        "jwt:c.randomBytes(48).toString('base64url'),"
        "drm:ed(),artifact:ed(),"
        "master:c.randomBytes(32).toString('base64'),"
        "oauth:c.randomBytes(32).toString('base64')}))"
    )
    result = subprocess.run([exe("node"), "-e", node_code], capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"{FAIL} cannot generate ephemeral secrets: {result.stderr}")
    payload = json.loads(result.stdout)
    return {
        "JWT_SECRET": payload["jwt"],
        "DRM_SERVER_PRIVATE_KEY": payload["drm"],
        "ARTIFACT_SIGNING_PRIVATE_KEY": payload["artifact"],
        "DRM_MASTER_KEY": payload["master"],
        "OAUTH_TOKEN_ENCRYPTION_KEY": payload["oauth"],
        "POSTGRES_PASSWORD": secrets.token_urlsafe(16),
        "S3_ENABLED": "true",
        "S3_BUCKET": "mta-market-local-release",
        "S3_ACCESS_KEY": "local-release",
        "S3_SECRET_KEY": secrets.token_urlsafe(24),
        "STACK_PREFIX": RELEASE_PREFIX,
        "NGINX_HTTP_PORT": "8080",
    }


def cmd_release() -> int:
    out("== MTA Market local release (production-like) ==")
    if not docker_available():
        out(f"  {FAIL} docker is not available")
        return 2
    data = load_env_config("production")
    temp_dir = TEMP / "runtime"
    temp_dir.mkdir(parents=True, exist_ok=True)
    env_file = temp_dir / "release.env"

    values: dict[str, str] = {}
    # Reuse real values from the environment when present; generate
    # explicitly ephemeral values for everything missing (local only).
    for key, generated in generate_ephemeral_secrets().items():
        values[key] = os.environ.get(key) or generated
    values["IMAGE_TAG"] = os.environ.get("IMAGE_TAG") or "local"
    values["GITHUB_REPOSITORY"] = os.environ.get("GITHUB_REPOSITORY") or "local/mta-market"
    values["BASE_URL"] = os.environ.get("BASE_URL") or "http://localhost:8080"
    values["FRONTEND_URL"] = os.environ.get("FRONTEND_URL") or "http://localhost:8080"
    values["NEXT_PUBLIC_API_URL"] = os.environ.get("NEXT_PUBLIC_API_URL") or "/api"
    values["LOG_FORMAT"] = "json"
    values["MEDIA_PUBLIC_BASE_URL"] = ""
    lines = [f"{key}={value}" for key, value in values.items()]
    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    out(f"  {INFO} local release env written to {env_file.relative_to(ROOT)} (ephemeral secrets, do not deploy)")

    out(f"  {INFO} building images ...")
    if compose(["build"], file=COMPOSE_PROD, env_file=env_file) != 0:
        out(f"  {FAIL} image build failed")
        return 1
    out(f"  {INFO} starting stack ...")
    if compose(["up", "-d", "--wait", "--wait-timeout", "240"], file=COMPOSE_PROD, env_file=env_file) != 0:
        out(f"  {INFO} --wait timed out; continuing with health polling")

    api_ok = docker_exec(f"{RELEASE_PREFIX}-backend", [
        "node", "-e",
        "require('http').get('http://localhost:3001/ready',r=>process.exit(r.statusCode===200?0:1))",
    ])
    web_ok = docker_exec(f"{RELEASE_PREFIX}-nginx", ["wget", "-q", "-O", "-", "http://localhost/health"])
    db_ok, _ = docker_exec(f"{RELEASE_PREFIX}-postgres", ["pg_isready", "-U", "mtamarket"])
    redis_ok, _ = docker_exec(f"{RELEASE_PREFIX}-redis", ["redis-cli", "ping"])
    for name, ok in (("API /ready", api_ok[0]), ("nginx -> web", web_ok[0]),
                     ("postgres", db_ok), ("redis", redis_ok[0])):
        out(f"  {mark(ok)} {name}")
    if not all(flag for flag, _ in [api_ok, web_ok, (db_ok, ""), redis_ok]):
        out(f"  {FAIL} release verification failed — see: docker compose -f {COMPOSE_PROD.name} ps")
        return 1
    out()
    out(f"  WEB : http://localhost:8080  (nginx -> frontend -> /api -> backend)")
    out(f"  stop: python startup.py stop   (volumes kept)")
    return 0


def ensure_test_infra(data: dict) -> bool:
    if not docker_available():
        out(f"  {FAIL} docker is not available")
        return False
    test_port = cfg_int(data, ("database", "test", "hostPort"), 5433)
    if port_open("127.0.0.1", test_port):
        return True
    if compose(["up", "-d", "--wait"], file=COMPOSE_TESTS) != 0:
        compose(["up", "-d"], file=COMPOSE_TESTS)
    return wait_ports({"postgres-test": test_port}, timeout=60)["postgres-test"]


def cmd_test(tier: str, keep: bool = False) -> int:
    data = load_env_config("development")
    vitest = [exe("pnpm"), "exec", "vitest", "run"]

    if tier == "unit":
        out("== L0: unit (no database required) ==")
        return sh([*vitest, "tests/unit"]).returncode

    if tier == "integration":
        out("== L1: integration + concurrency (isolated test database) ==")
        if not ensure_test_infra(data):
            return 1
        rc = sh([*vitest, "tests/integration", "tests/concurrency"]).returncode
        if not keep:
            out(f"  {INFO} destroying test infrastructure (disposable) ...")
            compose(["down", "-v", "--remove-orphans"], file=COMPOSE_TESTS)
        return rc

    if tier == "e2e":
        out("== browser E2E (dev servers + real browser) ==")
        if not ensure_dev_infra(data):
            return 1
        api_port = cfg_int(data, ("api", "port"), 3001)
        if not http_ok(f"http://127.0.0.1:{api_port}/health"):
            cmd_dev("backend")
        if not http_ok(f"http://127.0.0.1:{cfg_int(data, ('web', 'port'), 3000)}"):
            cmd_dev("web")
        out(f"  {INFO} seeding e2e admin ...")
        sh([exe("pnpm"), "test:e2e:admin"])
        return sh([exe("pnpm"), "exec", "playwright", "test"]).returncode

    if tier == "smoke":
        out("== runtime smoke (health probes) ==")
        api_port = cfg_int(data, ("api", "port"), 3001)
        web_port = cfg_int(data, ("web", "port"), 3000)
        if not ensure_dev_infra(data):
            return 1
        if not http_ok(f"http://127.0.0.1:{api_port}/health"):
            cmd_dev("backend")
        return 0 if run_smoke(api_port, web_port) else 1

    if tier == "affected":
        out("== L2: affected tests (vitest --changed) ==")
        base = os.environ.get("STARTUP_TEST_BASE") or "HEAD"
        return sh([*vitest, "--changed", base]).returncode

    if tier == "release":
        out("== L4: release validation (build + release stack + smoke) ==")
        if cmd_build() != 0:
            return 1
        return cmd_release()

    out(f"{FAIL} unknown test tier: {tier} (unit|integration|e2e|smoke|affected|release)")
    return 2


def run_smoke(api_port: int, web_port: int) -> bool:
    probes = (
        ("api /health", f"http://127.0.0.1:{api_port}/health"),
        ("api /live", f"http://127.0.0.1:{api_port}/live"),
        ("api /ready", f"http://127.0.0.1:{api_port}/ready"),
        ("api /metrics", f"http://127.0.0.1:{api_port}/metrics"),
        ("web /", f"http://127.0.0.1:{web_port}/"),
    )
    results = {name: http_ok(url) for name, url in probes}
    for name, ok in results.items():
        out(f"  {mark(ok)} {name}")
    return all(results.values())


def cmd_build() -> int:
    out("== build: site (turbo) ==")
    rc = sh([exe("pnpm"), "build"]).returncode
    if rc != 0:
        return rc
    out("== build: module ==")
    return cmd_module(build_only=True)


def module_preset() -> str | None:
    """Pick a module build preset for this host (module/CMakePresets.json)."""
    if not IS_WINDOWS:
        return "linux-gcc"
    data = load_env_config("development")
    configured = cfg_str(data, ("module", "build", "preset"), "linux-gcc")
    if have("cl"):
        return "win-msvc"
    if have("g++"):
        return "win-mingw"
    return None if configured not in ("win-msvc", "win-mingw") else configured


def cmd_module(build_only: bool = False) -> int:
    out("== module ==")
    if not have("cmake", "ninja"):
        out(f"  {FAIL} cmake/ninja missing (install: pip install cmake ninja, see documents/module/BUILD.md)")
        return 2
    preset = module_preset()
    if not preset:
        out(f"  {FAIL} no supported module toolchain on this host")
        out("      Windows module build is currently unsupported (POSIX-only DRM HTTP")
        out("      client; see documents/architecture/MODULE.md §support matrix).")
        return 2
    mod = ROOT / "module"
    if sh(["cmake", "--preset", preset], cwd=mod).returncode:
        out(f"  {FAIL} cmake configure failed ({preset})")
        return 1
    if sh(["cmake", "--build", "--preset", preset], cwd=mod).returncode:
        out(f"  {FAIL} module build failed ({preset})")
        return 1
    if build_only:
        return 0
    return sh(["ctest", "--preset", preset, "--output-on-failure"], cwd=mod).returncode


def cmd_db(action: str, targets: list[str], destructive: bool, assume_yes: bool) -> int:
    if action == "apply":
        return 0 if apply_schema() else 1
    if action == "seed":
        if not targets:
            targets = ["admin", "plan003", "plan005", "services"]
        return seed_database(targets)
    if action == "status":
        data = load_env_config("development")
        reachable = port_open("127.0.0.1", cfg_int(data, ("database", "port"), 5432))
        out(f"  {mark(reachable)} database reachable :{cfg_int(data, ('database', 'port'), 5432)}")
        out(f"  {INFO} schema state: run 'python startup.py db apply' to converge")
        return 0 if reachable else 1
    if action == "reset":
        if not destructive:
            out("  'reset' without --destructive only re-applies the schema (safe).")
            return 0 if apply_schema() else 1
        if not assume_yes:
            answer = input("This DESTROYS local dev database volumes + re-creates them. Type 'DELETE' to continue: ")
            if answer.strip() != "DELETE":
                out("  aborted")
                return 1
        if not docker_available():
            out(f"  {FAIL} docker is not available")
            return 2
        compose(["down", "-v", "--remove-orphans"], file=COMPOSE_DEV, project=DEV_PROJECT)
        if not ensure_dev_infra(load_env_config("development")):
            return 1
        return 0 if apply_schema() else 1
    out(f"{FAIL} unknown db action: {action} (apply|seed|reset|status)")
    return 2


def cmd_logs(name: str | None, follow: bool) -> int:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logs = sorted(LOG_DIR.glob("*.log"))
    if not logs:
        out(f"  {SKIP} no dev logs yet (logs/development)")
        return 0
    if name:
        candidates = [LOG_DIR / f"{name}.log"]
        if not candidates[0].exists():
            out(f"  {FAIL} no log named {name}.log (available: {', '.join(p.stem for p in logs_sorted())})")
            return 1
        paths = candidates
    else:
        paths = logs_sorted()
    if not follow:
        for path in paths:
            out(f"--- {path.name} (last 40 lines) ---")
            for line in tail_file(path, 40):
                out(line)
        return 0
    try:
        while True:
            os.system("cls" if IS_WINDOWS else "clear")
            for path in paths:
                out(f"--- {path.name} ---")
                for line in tail_file(path, 40):
                    out(line)
            time.sleep(2.0)
    except KeyboardInterrupt:
        return 0


def logs_sorted() -> list[Path]:
    return sorted(LOG_DIR.glob("*.log"))


def cmd_stop() -> int:
    out("== stopping local stack ==")
    for name in ("worker", "web", "backend"):
        stop_pid(name)
    if docker_available():
        compose(["stop"], file=COMPOSE_TESTS)
        compose(["stop"], file=COMPOSE_DEV, project=DEV_PROJECT)
        out(f"  {OK} infrastructure containers stopped (volumes kept)")
    return 0


def cmd_clean(destructive: bool, assume_yes: bool) -> int:
    """Remove disposable artifacts only (PLAN-017 §18)."""
    targets = [
        WEB_DIR / ".next",
        SERVER_DIR / "dist",
        ROOT / "module" / "build",
        ROOT / ".turbo" / "cache",
        ROOT / "coverage",
        ROOT / "playwright-report",
        ROOT / "test-results",
    ]
    removed = 0
    for path in targets:
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
            removed += 1
            out(f"  {OK} removed {path.relative_to(ROOT)}")
    # temp/ is fully disposable except .gitkeep placeholders.
    for keep_dir in TEMP.glob("*"):
        if keep_dir.is_dir():
            for entry in keep_dir.iterdir():
                if entry.name == ".gitkeep":
                    continue
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                else:
                    entry.unlink(missing_ok=True)
                removed += 1
    for pattern in ("*.tsbuildinfo",):
        for path in ROOT.glob(pattern):
            path.unlink(missing_ok=True)
            removed += 1
    for cache in list(ROOT.rglob("__pycache__")):
        shutil.rmtree(cache, ignore_errors=True)
    out(f"  {OK} temp/ emptied ({removed} targets cleaned)")
    if not destructive:
        out(f"  {SKIP} --destructive not passed: production data (DB volumes, uploads) untouched")
        return 0
    if not assume_yes:
        answer = input("Also destroy LOCAL DEV database volumes and uploads/? Type DELETE to continue: ")
        if answer.strip() != "DELETE":
            out("  aborted")
            return 1
    if docker_available():
        compose(["down", "-v", "--remove-orphans"], file=COMPOSE_DEV, project=DEV_PROJECT)
        compose(["down", "-v", "--remove-orphans"], file=COMPOSE_TESTS)
        out(f"  {OK} local dev/test volumes destroyed")
    uploads = ROOT / "uploads"
    if uploads.exists():
        shutil.rmtree(uploads, ignore_errors=True)
        uploads.mkdir(exist_ok=True)
        out(f"  {OK} uploads/ emptied")
    return 0


def cmd_doctor() -> int:
    out("== MTA Market environment diagnosis ==")
    rows: list[tuple[str, bool, str]] = []
    rows.append((f"python >= 3.10 ({sys.version.split()[0]})", sys.version_info >= (3, 10), ""))
    rows.append(("node", have("node"), shutil.which("node") or "install Node 22+"))
    rows.append(("pnpm", have("pnpm"), shutil.which("pnpm") or "corepack enable"))
    rows.append(("docker", docker_available(), shutil.which("docker") or "start Docker Desktop"))
    rows.append(("docker compose", docker_available() and sh_ok(["docker", "compose", "version"],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL), ""))
    rows.append(("cmake", have("cmake"), shutil.which("cmake") or "optional (module build)"))
    rows.append(("ninja", have("ninja"), shutil.which("ninja") or "optional (module build)"))
    compiler = next((tool for tool in ("g++", "gcc", "clang", "cl") if have(tool)), None)
    rows.append(("compiler", compiler is not None, compiler or "optional (module build)"))

    deps = (ROOT / "node_modules").exists()
    rows.append(("workspace deps installed", deps, "" if deps else "run: pnpm install"))
    rows.append(("site/server/.env (local secrets)", dotenv_exists(),
                 "" if dotenv_exists() else "copy from site/server/.env.example"))

    data = load_env_config("development")
    api_port = cfg_int(data, ("api", "port"), 3001)
    web_port = cfg_int(data, ("web", "port"), 3000)
    pg_port = cfg_int(data, ("database", "port"), 5432)
    # Port conflicts matter only when the port is held by something that is
    # not the expected service.
    if port_open("127.0.0.1", pg_port) and not container_running("mta-market-postgres"):
        rows.append((f"postgres port :{pg_port}", False,
                     "occupied by a foreign process — free it or stop the foreign service"))

    try:
        TEMP.mkdir(parents=True, exist_ok=True)
        probe = TEMP / ".doctor_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        rows.append(("temp/ writable", True, ""))
    except OSError as error:
        rows.append(("temp/ writable", False, str(error)))
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        probe = LOG_DIR / ".doctor-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        rows.append(("logs/ writable", True, ""))
    except OSError as error:
        rows.append(("logs/ writable", False, str(error)))

    _, config_issues = load_application_config()
    rows.append(("config/ valid", not config_issues, "; ".join(config_issues[:3])))

    if IS_WINDOWS:
        rows.append(("module build (windows)", False,
                     "expected limitation: module requires a POSIX toolchain (documents/architecture/MODULE.md)"))
    else:
        rows.append(("module build", have("cmake") and have("ninja") and have("g++"), ""))

    width = max(len(row[0]) for row in rows)
    blocking = 0
    optional = ("cmake", "ninja", "compiler", "module build")
    for name, ok, note in rows:
        out(f"  [{'PASS' if ok else 'FAIL'}] {name.ljust(width)}  {note}")
        # Module toolchain rows are optional diagnostics: the module is not
        # required for site development, and Windows module builds are an
        # expected limitation (documents/architecture/MODULE.md).
        if not ok and not name.startswith(optional):
            blocking += 1
    if blocking:
        out(f"\n  {blocking} blocking check(s) failed — see documents/architecture/TOOLCHAIN.md")
        return 1
    out("\n  environment ready. start: python startup.py dev")
    return 0


# ---------------------------------------------------------------------------
# Router.
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="startup.py", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command")

    dev = sub.add_parser("dev", help="full local development environment")
    dev.add_argument("only", nargs="?", choices=["infra", "schema", "backend", "worker", "web"])

    sub.add_parser("release", help="production-like local stack + smoke")

    test = sub.add_parser("test", help="run tests (L0-L4 tiers)")
    test.add_argument("tier", nargs="?", default="integration",
                      choices=["unit", "integration", "e2e", "smoke", "affected", "release"])
    test.add_argument("--keep", action="store_true", help="keep test infrastructure after the run")

    build = sub.add_parser("build", help="build site (and module)")
    build.add_argument("what", nargs="?", choices=["site", "module"])

    sub.add_parser("module", help="configure + build + test the native module")

    db = sub.add_parser("db", help="database operations")
    db.add_argument("action", nargs="?", default="apply", choices=["apply", "seed", "reset", "status"])
    db.add_argument("targets", nargs="*", help="seed targets: admin|plan003|plan005|services|heartbeat")
    db.add_argument("--destructive", action="store_true")
    db.add_argument("--yes", action="store_true")

    sub.add_parser("status", help="compact service table")
    logs = sub.add_parser("logs", help="show/tail dev logs")
    logs.add_argument("name", nargs="?", default=None)
    logs.add_argument("--follow", action="store_true")

    sub.add_parser("stop", help="stop local stack (volumes kept)")
    clean = sub.add_parser("clean", help="remove disposable artifacts")
    clean.add_argument("--destructive", action="store_true")
    clean.add_argument("--yes", action="store_true")

    sub.add_parser("doctor", help="environment diagnosis")
    return parser


ALIASES = {"tests": "test", "site": "build"}  # compatibility aliases


def main() -> int:
    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    argv = list(sys.argv[1:])
    if argv and argv[0] in ALIASES:
        argv[0] = ALIASES[argv[0]]
        if argv[0] == "build":
            argv.append("site")
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "dev":
        return cmd_dev(args.only)
    if args.command == "release":
        return cmd_release()
    if args.command == "test":
        return cmd_test(args.tier, keep=args.keep)
    if args.command == "build":
        if args.what == "module":
            return cmd_module(build_only=True)
        rc = sh([exe("pnpm"), "build"]).returncode
        if rc != 0:
            return rc
        return 0 if args.what == "site" else cmd_module(build_only=True)
    if args.command == "module":
        return cmd_module()
    if args.command == "db":
        return cmd_db(args.action, args.targets, args.destructive, args.yes)
    if args.command == "status":
        return cmd_status()
    if args.command == "logs":
        return cmd_logs(args.name, args.follow)
    if args.command == "stop":
        return cmd_stop()
    if args.command == "clean":
        return cmd_clean(args.destructive, args.yes)
    if args.command == "doctor":
        return cmd_doctor()
    return 2


if __name__ == "__main__":
    sys.exit(main())
