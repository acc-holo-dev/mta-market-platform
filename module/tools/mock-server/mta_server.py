#!/usr/bin/env python3
"""MTA server test harness.

Manages a PINNED, locally-installed MTA:SA server for integration tests:

    mta_server.py install    download + install the pinned server build
    mta_server.py update     re-install the pinned build (refresh)
    mta_server.py version    print the installed build identity
    mta_server.py start      start the server (kept running; debug use)
    mta_server.py stop       stop a server started by `start`
    mta_server.py test       full integration run (build module, temp server
                             dir, module install, test resources, scenario
                             choreography, graceful stop, log capture)

The integration test suite itself lives in other/tests/integration/:

    main_resource.lua      the "sdkintegration" resource: every scenario
                           reports its own "SCENARIO <name>: PASS|FAIL"
                           marker; three generations are choreographed by
                           this harness (stop/start cycle, console restart)
    witness_resource.lua   the "sdkintegration2" resource: multi-resource
                           witness that never restarts

The harness parses the scenario markers, drives the resource lifecycle
(stop -> start -> restart) through the server console, requires every
scenario plus the stale-generation regression to report PASS, fails on
any stale-delivery marker, and adds the two harness-side scenarios (module
unload at graceful shutdown, shutdown with active workers).

The pinned build identity lives in PINNED_WINDOWS / PINNED_LINUX (chosen for
the host by pinned_build()) and is recorded (with the download checksum) into
install.json after a successful install. Server binaries are never committed
(see .gitignore). No developer's global MTA installation is used; everything
runs from other/server/servers/<build> and a fresh temp directory per test
run (cleaned up afterwards).
"""

from __future__ import annotations

import dataclasses
import hashlib
import ctypes
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

SELF = Path(__file__).resolve()
SERVER_DIR = SELF.parent
PROJECT_ROOT = SERVER_DIR.parents[1]
TOOLS_DIR = PROJECT_ROOT / "other" / "tools" / "mta"

DOWNLOADS = SERVER_DIR / "downloads"
INSTALL_ROOT = SERVER_DIR / "servers"
INSTALL_JSON = SERVER_DIR / "install.json"
PID_JSON = SERVER_DIR / "server.pid"
LOGS_DIR = SERVER_DIR / "logs"

# Pinned server builds (never "latest"; the exact identity below is what the
# harness installs and what install.json records). One entry per supported
# host platform, 1.6 release line, nightly.mtasa.com. The expected_sha256 pins
# the download: an archive that does not match is rejected before extraction.
# pinned_build() selects the entry for the current host.
PINNED_WINDOWS = {
    "platform": "windows",
    "architecture": "x64",
    "branch": "1.6",
    "build": "24140",
    "build_date": "20260820",
    "filename": "mtasa_x64-1.6-rc-24140-20260820.exe",
    "url": "https://nightly.mtasa.com/mtasa_x64-1.6-rc-24140-20260820.exe",
    "expected_sha256": "113fb8ea5814a9c23cbb08dd55e3f91548a82f3a09f5ec562dd0f01fd981c5cc",
}

PINNED_LINUX = {
    "platform": "linux",
    "architecture": "x64",
    "branch": "1.6",
    "build": "24140",
    "build_date": "20260820",
    "filename": "multitheftauto_linux_x64-1.6.0-rc-24140.tar.gz",
    "url": "https://nightly.mtasa.com/multitheftauto_linux_x64-1.6.0-rc-24140.tar.gz",
    "expected_sha256": "48e5e7ea4be9497d2c2ba606c241c52d419daacb320462c4ed76c756c65dc69a",
}


def pinned_build() -> dict:
    """The pinned server build for the current host platform."""
    return PINNED_LINUX if os.name != "nt" else PINNED_WINDOWS

# NSIS extraction tool. The MTA installer ignores /D when an MTA install is
# already registered on the machine (it would touch the developer's global
# installation), so the harness unpacks the installer's
# payload directly with a locally provisioned 7-Zip. The .msi is unpacked
# with `msiexec /a` (an administrative image: plain file extraction, no
# elevation), because the .exe installer's manifest requires elevation.
SEVENZIP = {
    "filename": "7z2602-x64.msi",
    "url": "https://github.com/ip7z/7zip/releases/download/26.02/7z2602-x64.msi",
}
SEVENZIP_DIR = SERVER_DIR / "tools" / "7zip"

TEST_RESOURCE_NAME = "sdkintegration"
WITNESS_RESOURCE_NAME = "sdkintegration2"
INTEGRATION_DIR = PROJECT_ROOT / "other" / "tests" / "integration"
MAIN_LUA_PATH = INTEGRATION_DIR / "main_resource.lua"
WITNESS_LUA_PATH = INTEGRATION_DIR / "witness_resource.lua"
INTEGRATION_TIMEOUT = 180.0

MARK = "INTEGRATION:"
MARK_RESULT = "INTEGRATION_RESULT:"

# Generational choreography markers printed by the Lua suite (one each):
#   STOP_NOW      generation 1 is done -> harness stops + starts the resource
#                 (the dedicated resource stop/start cycle)
#   RESTART_NOW   generation 2 is done -> harness restarts the resource
#                 (console restart; the stale-generation regression cycle)
#   RUN_COMPLETE  generation 3 is done -> harness performs the graceful
#                 shutdown (with an active worker still pending)
MARK_STOP_NOW = "STOP_NOW"
MARK_RESTART_NOW = "RESTART_NOW"
MARK_RUN_COMPLETE = "RUN_COMPLETE"

# Negative markers: if ANY of these appears anywhere in the console log, the
# run fails -- stale generation-1/2 deliveries, a delivery into the fresh
# VM's first-callback registry slot, or a task that fired during shutdown.
NEGATIVE_MARKERS = (
    "STALE_TASK_DELIVERED",
    "OLD_CALLBACK_FIRED",
    "STALE_COLLISION_FIRED",
    "SHOULD_NEVER_FIRE",
)

# Every scenario plus the automatic stale-generation regression. Each
# of these must be reported with its own "SCENARIO <name>: PASS" marker and
# never with FAIL; "module unload" and "shutdown with active workers" are
# judged by the harness itself (their observable moment is the shutdown).
REQUIRED_SCENARIOS = (
    "module load",
    "module unload",
    "resource start",
    "resource stop",
    "resource restart",
    "function registration",
    "argument validation",
    "return values",
    "callback",
    "timer",
    "async task",
    "async completion",
    "userdata",
    "userdata invalidation",
    "multiple resources",
    "old callback after restart",
    "old async task after restart",
    "multiple timers after restart",
    "shutdown with active workers",
    "stale generation regression (33)",
)

SCENARIO_RE = re.compile(r"SCENARIO (.+?): (PASS|FAIL)")

# Delay between the `stop` and `start` console commands of the stop/start cycle.
# MTA processes console commands in order, so the start always executes
# after the stop completes regardless of timing.
STOP_TO_START_DELAY = 2.0
# Settle time after RUN_COMPLETE before the graceful shutdown: late stale
# deliveries (if the module regressed) would still be visible.
SHUTDOWN_SETTLE = 2.0

# Scancodes for the console keys the harness must inject (MTA reads the
# console input buffer, not stdin, so commands are typed as key events).
SCAN_CODES = {
    **{chr(c): c - 0x41 + 0x1E for c in range(0x41, 0x5B)},  # A..Z
    " ": 0x39,
    "\r": 0x1C,
    "1": 0x02, "2": 0x03, "3": 0x04, "4": 0x05, "5": 0x06,
    "6": 0x07, "7": 0x08, "8": 0x09, "9": 0x0A, "0": 0x0B,
    ".": 0x33, "-": 0x0C, "/": 0x35,
}
VK_CODES = {"\r": 0x0D, " ": 0x20, **{chr(c): c for c in range(0x41, 0x5B)},
            **{str(d): 0x30 + d for d in range(10)}, ".": 0xBE, "-": 0xBD, "/": 0xBF}


def out(text: str = "") -> None:
    print(text, flush=True)


def die(message: str, code: int = 1) -> None:
    print(f"mta_server: error: {message}", file=sys.stderr, flush=True)
    sys.exit(code)


def load_cli():
    sys.path.insert(0, str(SERVER_DIR.parent / "tools" / "mta"))
    import cli  # noqa: PLC0415 (local import keeps CLI coupling explicit)

    return cli


def load_config() -> dict:
    cli = load_cli()
    return cli.load_config(PROJECT_ROOT)


def module_binary(config: dict) -> Path | None:
    cli = load_cli()
    preset = cli.default_preset(PROJECT_ROOT)
    return cli.output_binary(PROJECT_ROOT, preset, config)


# --- install ------------------------------------------------------------------


def download(url: str, target: Path, attempts: int = 3) -> Path:
    out(f"Downloading {url} ...")
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "mta-sdk-harness/1.0"})
    # CI runners are fresh and download this every run; transient resets from
    # the host (WinError 10054 / URLError) retry instead of failing the job.
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=180) as response, target.open("wb") as sink:
                shutil.copyfileobj(response, sink, length=1 << 20)
            return target
        except (urllib.error.URLError, ConnectionResetError, OSError) as err:
            target.unlink(missing_ok=True)
            if attempt == attempts:
                die(f"download failed after {attempts} attempts: {err}")
            out(f"  download attempt {attempt} failed ({err}); retrying ...")
    die("download failed")


def find_server_exe(base: Path) -> Path | None:
    # Windows ships MTA Server64.exe; the Linux tarball ships a bare
    # mta-server64 (no extension). Search both spellings.
    for name in (
        "MTA Server64.exe",
        "mta-server64.exe",
        "mta-server64",
        "mta-server.exe",
        "mta-server",
        "MTA Server.exe",
    ):
        hit = next(base.rglob(name), None)
        if hit:
            return hit
    # Windows fallback: the installer may name the server differently, so
    # accept any server-named .exe (never the uninstaller).
    if os.name == "nt":
        for exe in base.rglob("*.exe"):
            lowered = exe.name.lower()
            if "server" in lowered and "uninstall" not in lowered:
                return exe
    return None


def ensure_default_acl(mods: Path) -> None:
    """Provide a default acl.xml when the installed server did not ship one.

    The Linux server tarball ships an empty mods/deathmatch (no default
    acl.xml) and the server refuses to start without one; the Windows
    installer already places it. Never overwrites an existing acl.xml.
    """
    acl_xml = mods / "acl.xml"
    if acl_xml.is_file():
        return
    template = SERVER_DIR / "templates" / "acl.xml"
    if not template.is_file():
        die(f"missing default ACL template: {template}")
    shutil.copy2(template, acl_xml)
    out("Installed default acl.xml (the Linux server ships an empty mods/deathmatch)")


def sevenzip_exe() -> Path:
    """Locally provisioned 7-Zip console (downloads it on first use)."""
    exe = SEVENZIP_DIR / "Files" / "7-Zip" / "7z.exe"
    if exe.is_file():
        return exe
    msi = DOWNLOADS / SEVENZIP["filename"]
    if not msi.is_file():
        download(SEVENZIP["url"], msi)
    out(f"Provisioning 7-Zip into {SEVENZIP_DIR} (msiexec administrative image) ...")
    result = subprocess.run(
        ["msiexec", "/a", str(msi), f"TARGETDIR={SEVENZIP_DIR}", "/qn"],
        timeout=300,
        capture_output=True,
        text=True,
    )
    if not exe.is_file():
        die(f"msiexec /a did not produce 7z.exe (code {result.returncode}); inspect {SEVENZIP_DIR}")
    return exe


def extract_server(pinned: dict, archive: Path, install_dir: Path) -> str:
    """Extract the pinned server archive into install_dir.

    Windows: the MTA installer is unpacked directly with a locally
    provisioned 7-Zip (its manifest requires elevation, so the harness
    extracts the payload instead of running it). Linux: the server ships as a
    tar.gz, extracted with the system tar.

    Returns a diagnostic line used by the caller when no server executable is
    found afterwards.
    """
    if os.name != "nt":
        result = subprocess.run(
            ["tar", "xzf", str(archive), "-C", str(install_dir)],
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        return (
            "tar extraction produced no server executable; "
            f"tar output: {(result.stdout or result.stderr or '')[-400:]}"
        )
    sevenzip = sevenzip_exe()
    out(f"Extracting {archive.name} (direct payload extraction, isolated dir) ...")
    result = subprocess.run(
        [str(sevenzip), "x", str(archive), f"-o{install_dir}", "-y"],
        capture_output=True,
        text=True,
        timeout=600,
    )
    return (
        f"7-Zip extraction produced no server executable; "
        f"7z output: {(result.stdout or result.stderr or '')[-400:]}"
    )


def cmd_install(update: bool) -> int:
    pinned = pinned_build()
    if INSTALL_JSON.is_file() and not update:
        out("Already installed:")
        cmd_version()
        return 0

    archive = DOWNLOADS / pinned["filename"]
    if not archive.is_file():
        download(pinned["url"], archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    expected = pinned.get("expected_sha256")
    if expected and digest != expected:
        die(
            f"the downloaded server archive does not match the pinned checksum:\n"
            f"  downloaded: {digest}\n  expected:   {expected}\n"
            f"Delete {archive} and re-run the install if the pinned build was updated."
        )

    install_dir = INSTALL_ROOT / f"mtasa-{pinned['build']}"
    if install_dir.exists():
        shutil.rmtree(install_dir)
    install_dir.mkdir(parents=True)

    diagnostic = extract_server(pinned, archive, install_dir)
    server_exe = find_server_exe(install_dir)
    if server_exe is None:
        die(diagnostic)

    INSTALL_JSON.write_text(
        json.dumps(
            {**pinned, "sha256": digest, "install_dir": str(server_exe.parent), "server_exe": str(server_exe)},
            indent=2,
        ),
        encoding="utf-8",
    )
    out(f"Server executable: {server_exe}")
    out("Installed; identity recorded in other/server/install.json")
    return 0


def cmd_version() -> int:
    if not INSTALL_JSON.is_file():
        out("not installed")
        return 1
    info = json.loads(INSTALL_JSON.read_text(encoding="utf-8"))
    out(
        f"MTA server {info['branch']} build {info['build']} "
        f"({info['platform']}/{info['architecture']}, {info['build_date']})"
    )
    out(f"  sha256: {info['sha256']}")
    out(f"  install_dir: {info['install_dir']}")
    return 0


def cmd_start() -> int:
    info = require_install()
    workdir = SERVER_DIR / "run"
    workdir.mkdir(exist_ok=True)
    creationflags = subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0
    process = subprocess.Popen(
        [info["server_exe"]],
        cwd=str(workdir),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    PID_JSON.write_text(json.dumps({"pid": process.pid}), encoding="utf-8")
    out(f"Server started (pid {process.pid}) in {workdir}")
    out(f"Stop it with: python {SELF} stop")
    return 0


def cmd_stop() -> int:
    if not PID_JSON.is_file():
        out("no server pid recorded")
        return 0
    pid = json.loads(PID_JSON.read_text(encoding="utf-8"))["pid"]
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
    else:
        subprocess.run(["kill", str(pid)], capture_output=True)
    PID_JSON.unlink(missing_ok=True)
    out(f"Server {pid} stopped")
    return 0


def require_install() -> dict:
    if not INSTALL_JSON.is_file():
        die("the pinned server is not installed; run `mta server install` first")
    return json.loads(INSTALL_JSON.read_text(encoding="utf-8"))


# --- integration test ---------------------------------------------------------


@dataclasses.dataclass
class RunResult:
    """Everything the harness learned from one server run."""

    tail: list[str] = dataclasses.field(default_factory=list)
    # scenario name -> list of verdicts (True = PASS)
    scenarios: dict[str, list[bool]] = dataclasses.field(default_factory=dict)
    negative: list[str] = dataclasses.field(default_factory=list)
    results: list[bool] = dataclasses.field(default_factory=list)
    failed: bool = False
    failure_reason: str = ""
    run_complete: bool = False
    graceful: bool = False
    returncode: int | None = None


def resource_meta(resource_name: str) -> str:
    return (
        "<meta>\n"
        f'    <info author="MTA Module SDK" name="{resource_name}" type="script" version="1.0.0"/>\n'
        '    <script src="main.lua" type="server"/>\n'
        "</meta>\n"
    )


def read_integration_script(path: Path) -> str:
    if not path.is_file():
        die(
            f"integration script missing: {path} "
            f"(the integration test suite lives in {INTEGRATION_DIR})"
        )
    return path.read_text(encoding="utf-8")


def cmd_test(args) -> int:
    info = require_install()
    config = load_config()
    main_lua = read_integration_script(MAIN_LUA_PATH)
    witness_lua = read_integration_script(WITNESS_LUA_PATH)

    out("Building the module ...")
    build = subprocess.run(
        [sys.executable, str(SERVER_DIR.parent / "tools" / "mta" / "cli.py"), "build"],
        cwd=str(PROJECT_ROOT),
    )
    if build.returncode != 0:
        die("module build failed")
    binary = module_binary(config)
    if binary is None:
        die("module binary not found after the build")

    # Fresh temporary server directory per run, cleaned up after.
    temp_root = Path(tempfile.mkdtemp(prefix="mta-sdk-integration-"))
    server_root = temp_root / "server"
    out(f"Preparing the temporary server directory {server_root} ...")
    shutil.copytree(info["install_dir"], server_root)

    mods = server_root / "mods" / "deathmatch"
    if not mods.is_dir():
        shutil.rmtree(temp_root, ignore_errors=True)
        die(f"unexpected server layout (no mods/deathmatch in {info['install_dir']})")

    ensure_default_acl(mods)

    # The x64 server loads modules from <server>/x64/modules (SERVER_BIN_PATH_MOD).
    modules_dir = server_root / "x64" / "modules"
    modules_dir.mkdir(exist_ok=True)
    shutil.copy2(binary, modules_dir / binary.name)
    out(f"Module installed: x64/modules/{binary.name}")

    resources_dir = mods / "resources"
    resources_dir.mkdir(exist_ok=True)
    for resource_name, script in (
        (TEST_RESOURCE_NAME, main_lua),
        (WITNESS_RESOURCE_NAME, witness_lua),
    ):
        resource_dir = resources_dir / resource_name
        resource_dir.mkdir()
        (resource_dir / "meta.xml").write_text(resource_meta(resource_name), encoding="utf-8")
        (resource_dir / "main.lua").write_text(script, encoding="utf-8")
    out(f"Test resources installed: {TEST_RESOURCE_NAME}, {WITNESS_RESOURCE_NAME}")

    # Unique ports per run so parallel runs never collide. The server's config
    # location is not fully reliable across builds (the Windows server has been
    # seen reading it from the server root, the Linux one from mods/deathmatch),
    # so write both -- the harness must not depend on which one a build reads.
    base = 23000 + (os.getpid() % 2000)
    conf_text = "\n".join(
        [
            "<config>",
            "    <servername>sdk-integration</servername>",
            f"    <serverport>{base}</serverport>",
            f"    <httpport>{base + 2}</httpport>",
            "    <maxplayers>4</maxplayers>",
            f'    <module src="{binary.name}"></module>',
            f'    <resource src="{TEST_RESOURCE_NAME}" startup="1"/>',
            f'    <resource src="{WITNESS_RESOURCE_NAME}" startup="1"/>',
            "</config>",
        ]
    )
    (mods / "mtaserver.conf").write_text(conf_text, encoding="utf-8")
    (server_root / "mtaserver.conf").write_text(conf_text, encoding="utf-8")

    log_copy = LOGS_DIR / time.strftime("%Y%m%d-%H%M%S")
    result: RunResult | None = None
    try:
        out("Starting the server (temp directory) ...")
        result = run_server(info, server_root)
    finally:
        log_copy.mkdir(parents=True, exist_ok=True)
        # The pinned server runs without a configured log file; the console
        # scrollback (Windows) / captured stdout (Linux) IS the run log.
        console_log = log_copy / "server.log"
        log_text = "\n".join(result.tail) if result is not None else ""
        console_log.write_text(log_text, encoding="utf-8", errors="replace")
        out(f"Log kept at: {console_log}")
        shutil.rmtree(temp_root, ignore_errors=True)
        out("Temporary server directory cleaned up")
    if result is None:
        return 1
    return finalize_run(result, console_log)


class ServerProcess:
    """Platform-agnostic handle to a running MTA server.

    The common interface (poll/wait/returncode) lives here; the platform-
    specific console I/O is implemented by the subclasses so each platform's
    behaviour is readable in one place:

    - WindowsServerProcess: the server shares the harness console. Output is
      read from the console buffer (the full scrollback); commands are typed
      into the console input buffer through Win32 key injection.
    - LinuxServerProcess: the headless server runs with piped stdin/stdout
      under `stdbuf -oL` (line-buffered, so markers arrive in real time); a
      reader thread captures output from the stdout pipe.
    """

    def __init__(self, process: "subprocess.Popen", platform: str) -> None:
        self.process = process
        self.platform = platform

    @property
    def returncode(self):
        return self.process.returncode

    def poll(self):
        return self.process.poll()

    def wait(self, timeout: float):
        return self.process.wait(timeout=timeout)

    def read_lines(self) -> list[str]:
        """Full output accumulated so far. Callers deduplicate by tail position."""
        raise NotImplementedError

    def send(self, text: str) -> None:
        raise NotImplementedError

    def kill(self) -> None:
        raise NotImplementedError

    @property
    def reader_error(self) -> str | None:
        """Set when the output reader thread failed; None while it is healthy."""
        return None


class WindowsServerProcess(ServerProcess):
    """Windows: the server shares the harness console (buffer read + key injection)."""

    def __init__(self, process: "subprocess.Popen") -> None:
        super().__init__(process, "windows")

    def read_lines(self) -> list[str]:
        return console_buffer_lines()

    def send(self, text: str) -> None:
        # The console command needs its submit key: Enter (\r).
        if not text.endswith("\r"):
            text += "\r"
        inject_console_text(text)

    def kill(self) -> None:
        subprocess.run(["taskkill", "/PID", str(self.process.pid), "/T", "/F"], capture_output=True)


class LinuxServerProcess(ServerProcess):
    """Linux: piped stdin/stdout under `stdbuf -oL`; a reader thread captures output."""

    def __init__(self, process: "subprocess.Popen") -> None:
        super().__init__(process, "linux")
        self._lines: list[str] = []
        self._reader_error: str | None = None
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        # Surface a reader failure instead of hanging the run until the
        # timeout: wait_for_results checks reader_error and fails fast.
        try:
            for raw in self.process.stdout:
                self._lines.append(raw.rstrip("\r\n"))
        except Exception as err:  # noqa: BLE001 - record, don't hang
            self._reader_error = f"{type(err).__name__}: {err}"

    @property
    def reader_error(self) -> str | None:
        return self._reader_error

    def read_lines(self) -> list[str]:
        return list(self._lines)

    def send(self, text: str) -> None:
        # The console command needs its submit key: a newline on the stdin pipe.
        if not text.endswith("\n"):
            text += "\n"
        try:
            self.process.stdin.write(text)
            self.process.stdin.flush()
        except (BrokenPipeError, OSError):
            pass

    def kill(self) -> None:
        self.process.kill()


def start_server(info: dict, server_root: Path) -> ServerProcess:
    """Start the pinned server and return a platform-agnostic handle.

    Windows: the server requires a real console for both output and input (its
    startup verifies the stdout handle with GetConsoleScreenBufferInfo and
    quits otherwise, and it reads commands from the console input buffer), so
    the harness ensures a console exists, points the server's stdin/stdout at
    it (CONIN$/CONOUT$) and drives it through the same console.
    Linux: the headless server runs with piped stdin/stdout. It is launched
    under `stdbuf -oL -eL` so its stdout is line-buffered: a plain pipe would
    block-buffer the server's output and its markers would not arrive in real
    time. A reader thread captures output from the stdout pipe.
    """
    ensure_console()
    if os.name == "nt":
        # Both handles need GENERIC_READ|GENERIC_WRITE: the server verifies
        # its stdout handle with GetConsoleScreenBufferInfo, which a
        # write-only console handle fails.
        stdin_handle = console_handle("CONIN$", 0xC0000000)
        stdout_handle = console_handle("CONOUT$", 0xC0000000)
        kernel32 = ctypes.WinDLL("kernel32")
        handle_flag_inherit = 0x1
        kernel32.SetHandleInformation(stdin_handle, handle_flag_inherit, handle_flag_inherit)
        kernel32.SetHandleInformation(stdout_handle, handle_flag_inherit, handle_flag_inherit)
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags = subprocess.STARTF_USESTDHANDLES
        startupinfo.hStdInput = stdin_handle
        startupinfo.hStdOutput = stdout_handle
        startupinfo.hStdError = stdout_handle
        process = subprocess.Popen(
            [info["server_exe"], *server_args("windows")],
            cwd=str(server_root),
            startupinfo=startupinfo,
            close_fds=False,
        )
        kernel32.CloseHandle(stdin_handle)
        kernel32.CloseHandle(stdout_handle)
        return WindowsServerProcess(process)

    process = subprocess.Popen(
        ["stdbuf", "-oL", "-eL", info["server_exe"], *server_args("linux")],
        cwd=str(server_root),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    return LinuxServerProcess(process)


def server_args(platform: str) -> list[str]:
    """Extra CLI args for the pinned server on a given platform.

    The Windows server is started with `-t` (test mode); the Linux server
    takes no extra flags. Kept in one place so the divergence is explicit.
    """
    return ["-t"] if platform == "windows" else []


def run_server(info: dict, server_root: Path) -> RunResult:
    server = start_server(info, server_root)
    result: RunResult | None = None
    try:
        result = wait_for_results(server)
        return result
    finally:
        graceful, returncode = stop_process(server)
        if result is not None:
            result.graceful = graceful
            result.returncode = returncode
            # Pick up anything printed between the last poll and the shutdown
            # (the graceful-stop output is part of the evidence, e.g. the
            # "Server stopped!" line the shutdown scenarios judge on).
            tail = server.read_lines()
            result.tail.extend(tail[len(result.tail):])


def ensure_console() -> None:
    if os.name != "nt":
        return
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    if kernel32.GetConsoleWindow() is None:
        kernel32.AllocConsole()


def console_handle(name: str, access: int):
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    # GENERIC_READ|GENERIC_WRITE, FILE_SHARE_READ|FILE_SHARE_WRITE,
    # OPEN_EXISTING
    handle = kernel32.CreateFileW(name, access, 3, None, 3, 0, None)
    return handle


def console_buffer_lines() -> list[str]:
    """Reads the console buffer history (server shares the console with us).

    Reads up to the cursor row so the scrollback captured so far is covered;
    empty trailing rows are dropped.
    """
    if os.name != "nt":
        return []
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class COORD(ctypes.Structure):
        _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]

    class SMALL_RECT(ctypes.Structure):
        _fields_ = [
            ("Left", ctypes.c_short),
            ("Top", ctypes.c_short),
            ("Right", ctypes.c_short),
            ("Bottom", ctypes.c_short),
        ]

    class CSBI(ctypes.Structure):
        _fields_ = [
            ("dwSize", COORD),
            ("dwCursorPosition", COORD),
            ("wAttributes", ctypes.c_ushort),
            ("srWindow", SMALL_RECT),
            ("dwMaximumWindowSize", COORD),
        ]

    handle = console_handle("CONOUT$", 0xC0000000)
    if handle in (-1, ctypes.c_void_p(-1).value):
        return []
    info = CSBI()
    ok = kernel32.GetConsoleScreenBufferInfo(handle, ctypes.byref(info))
    if not ok:
        kernel32.CloseHandle(handle)
        return []
    width = info.dwSize.X
    height = info.dwCursorPosition.Y + 1  # content only exists up to the cursor
    buffer = ctypes.create_unicode_buffer(width + 1)
    chars_read = ctypes.c_ulong()
    lines = []
    for row in range(height):
        kernel32.ReadConsoleOutputCharacterW(
            handle, buffer, width, COORD(0, row), ctypes.byref(chars_read)
        )
        lines.append(buffer.value[: chars_read.value].rstrip())
    kernel32.CloseHandle(handle)
    return [line for line in lines if line.strip()]


def inject_console_text(text: str) -> None:
    """Types text into the console input buffer (server reads key events)."""
    if os.name != "nt":
        return
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class COORD(ctypes.Structure):
        _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]

    class KEY_EVENT_RECORD(ctypes.Structure):
        _fields_ = [
            ("bKeyDown", ctypes.c_int),
            ("wRepeatCount", ctypes.c_ushort),
            ("wVirtualKeyCode", ctypes.c_ushort),
            ("wVirtualScanCode", ctypes.c_ushort),
            ("UnicodeChar", ctypes.c_wchar),
            ("dwControlKeyState", ctypes.c_ulong),
        ]

    class INPUT_RECORD(ctypes.Structure):
        class _Event(ctypes.Union):
            _fields_ = [("KeyEvent", KEY_EVENT_RECORD)]

        # x64 layout: WORD EventType + (implicit 2-byte alignment pad) +
        # 16-byte event = 20 bytes; no extra padding field.
        _fields_ = [("EventType", ctypes.c_ushort), ("Event", _Event)]

    handle = console_handle("CONIN$", 0xC0000000)
    if handle in (-1, ctypes.c_void_p(-1).value):
        out("Console input not available for key injection")
        return
    records = (INPUT_RECORD * (len(text) * 2))()
    for index, char in enumerate(text):
        lower = char.lower() if char.isalpha() else char
        vk = VK_CODES.get(lower, ord(lower))
        scan = SCAN_CODES.get(lower, 0)
        for down in (1, 0):
            record = records[index * 2 + (0 if down else 1)]
            record.EventType = 1  # KEY_EVENT
            record.Event.KeyEvent.bKeyDown = down
            record.Event.KeyEvent.wRepeatCount = 1
            record.Event.KeyEvent.wVirtualKeyCode = vk
            record.Event.KeyEvent.wVirtualScanCode = scan
            record.Event.KeyEvent.UnicodeChar = char
            record.Event.KeyEvent.dwControlKeyState = 0
    written = ctypes.c_ulong()
    ok = kernel32.WriteConsoleInputW(handle, records, len(text) * 2, ctypes.byref(written))
    kernel32.CloseHandle(handle)
    if not ok or written.value != len(text) * 2:
        out(f"Key injection incomplete (ok={ok}, written={written.value})")


def wait_for_results(server: ServerProcess) -> RunResult:
    """Runs the full scenario choreography against the live server console.

    Generation markers emitted by the Lua suite drive the harness: STOP_NOW
    -> `stop` + `start` (dedicated resource stop/start cycle), RESTART_NOW ->
    `restart` (the stale-generation regression cycle), RUN_COMPLETE -> graceful shutdown
    follows in stop_process. Every scenario marker and every stale-delivery
    marker in the console log is collected into the result.
    """
    deadline = time.time() + INTEGRATION_TIMEOUT
    result = RunResult()
    phase = "gen1"  # gen1 -> stopping -> gen2 -> gen3 -> done
    stop_sent_at: float | None = None
    done_at: float | None = None
    seen = 0  # how many lines of the accumulated output are already consumed

    while time.time() < deadline:
        # Consume only the lines appended since the last poll (the console
        # scrollback on Windows, the accumulated stdout on Linux).
        lines = server.read_lines()
        for line in lines[seen:]:
            seen += 1
            result.tail.append(line)
            for marker in NEGATIVE_MARKERS:
                if marker in line and marker not in result.negative:
                    result.negative.append(marker)
                    out(f"!! {line}")
            for name, verdict in SCENARIO_RE.findall(line):
                result.scenarios.setdefault(name.strip(), []).append(verdict == "PASS")
            if MARK_RESULT in line:
                passed = "PASS" in line
                result.results.append(passed)
                out(line)
                if not passed:
                    result.failed = True
                    result.failure_reason = "a generation reported INTEGRATION_RESULT: FAIL"
                    dump_tail(result.tail)
                    return result
            if phase == "gen1" and MARK_STOP_NOW in line:
                phase = "stopping"
                stop_sent_at = time.time()
                out("Generation 1 done; stopping the resource (resource stop/start cycle) ...")
                server.send(f"stop {TEST_RESOURCE_NAME}")
            if phase == "gen2" and MARK_RESTART_NOW in line:
                phase = "gen3"
                out("Generation 2 done; restarting the resource (stale-generation regression cycle) ...")
                server.send(f"restart {TEST_RESOURCE_NAME}")
            if phase == "gen3" and MARK_RUN_COMPLETE in line:
                phase = "done"
                done_at = time.time()

        if result.negative:
            result.failed = True
            result.failure_reason = "stale delivery marker(s) appeared: " + ", ".join(result.negative)
            dump_tail(result.tail)
            return result

        # The stop->start transition of the stop/start cycle. Console commands are
        # processed in order, so this start always follows the completed stop.
        if (
            phase == "stopping"
            and stop_sent_at is not None
            and time.time() - stop_sent_at >= STOP_TO_START_DELAY
        ):
            out("Starting the resource again ...")
            server.send(f"start {TEST_RESOURCE_NAME}")
            phase = "gen2"

        if phase == "done" and done_at is not None and time.time() - done_at >= SHUTDOWN_SETTLE:
            result.run_complete = True
            break

        if server.poll() is not None:
            result.failed = True
            result.failure_reason = "the server exited before the integration run completed"
            out("The server exited before the integration result; console tail:")
            dump_tail(result.tail)
            return result

        # A dead output reader would otherwise hang the run until the timeout
        # with an empty tail; fail fast with the real cause instead.
        reader_error = server.reader_error
        if reader_error:
            result.failed = True
            result.failure_reason = f"output reader failed: {reader_error}"
            out(f"The output reader failed ({reader_error}); console tail:")
            dump_tail(result.tail)
            return result
        time.sleep(0.2)
    else:
        result.failed = True
        result.failure_reason = "timed out waiting for the integration run to complete"
        out("Timed out waiting for the integration results; console tail:")
        dump_tail(result.tail)
    return result


def evaluate_shutdown_scenarios(result: RunResult) -> list[tuple[str, bool, str]]:
    """Judges the two scenarios whose observable moment is the shutdown.

    module unload                 the module is unloaded exactly once, at
                                  ShutdownModule during a graceful console
                                  shutdown (a crash or forced kill fails)
    shutdown with active workers  a 60 s task was still pending when the
                                  server shut down and never delivered
    """
    stopped_line = any("Server stopped!" in line for line in result.tail)
    worker_armed = any("shutdown worker armed" in line for line in result.tail)
    late_delivery = any("SHOULD_NEVER_FIRE" in line for line in result.tail)

    module_unload_ok = result.graceful and stopped_line
    shutdown_ok = result.graceful and worker_armed and not late_delivery
    return [
        (
            "module unload",
            module_unload_ok,
            f"graceful console shutdown with the module loaded; returncode={result.returncode}",
        ),
        (
            "shutdown with active workers",
            shutdown_ok,
            "a 60 s worker was still pending at the graceful shutdown, "
            + ("no late delivery marker" if not late_delivery else "a late delivery marker appeared"),
        ),
    ]


def finalize_run(result: RunResult, console_log: Path) -> int:
    """Validates one finished run: scenario coverage, stale markers, shutdown."""
    # result.tail already carries the full run including the graceful-shutdown
    # output (run_server picked up the final lines before returning).
    ok = not result.failed and result.run_complete

    # Negative markers anywhere in the log fail the run (# stale objects must never deliver into a fresh generation).
    for line in result.tail:
        for marker in NEGATIVE_MARKERS:
            if marker in line and marker not in result.negative:
                result.negative.append(marker)
    for marker in result.negative:
        ok = False
        out(f"FAILED: a stale/shutdown delivery marker appeared in the log: {marker}")

    # The two harness-side scenarios (their observable moment is the
    # shutdown, so only the harness can report them) are appended to the log
    # to keep it self-contained.
    for name, passed, detail in evaluate_shutdown_scenarios(result):
        result.scenarios.setdefault(name, []).append(passed)
        line = f"SCENARIO {name}: {'PASS' if passed else 'FAIL'} ({detail})"
        out(MARK + " " + line)
        with console_log.open("a", encoding="utf-8") as sink:
            sink.write("\n" + line + "\n")

    missing = [name for name in REQUIRED_SCENARIOS if not result.scenarios.get(name)]
    failed_scenarios = sorted(name for name, verdicts in result.scenarios.items() if not all(verdicts))
    if ok and missing:
        ok = False
        out("FAILED: scenarios without a PASS marker: " + ", ".join(missing))
    if ok and failed_scenarios:
        ok = False
        out("FAILED: scenarios reported FAIL: " + ", ".join(failed_scenarios))
    if ok and not all(result.results):
        ok = False
        out("FAILED: an INTEGRATION_RESULT reported FAIL")

    out("Scenarios covered:")
    for name in REQUIRED_SCENARIOS:
        verdicts = result.scenarios.get(name, [])
        if verdicts and all(verdicts):
            status = "PASS"
        elif verdicts:
            status = "FAIL"
        else:
            status = "MISSING"
        extra = f" ({len(verdicts)} reports)" if len(verdicts) > 1 else ""
        out(f"  - {name}: {status}{extra}")
    for name in sorted(set(result.scenarios) - set(REQUIRED_SCENARIOS)):
        status = "PASS" if all(result.scenarios[name]) else "FAIL"
        out(f"  - {name} (extra): {status}")

    if ok:
        out(
            "All integration scenarios passed (19 scenarios + the stale-generation regression; "
            "stale generations isolated, clean shutdown with active workers)"
        )
        return 0
    out(f"Integration run FAILED: {result.failure_reason or 'see the messages above'}")
    return 1


def dump_tail(tail: list[str]) -> None:
    for line in tail[-30:]:
        out("  " + line)


def stop_process(server: ServerProcess) -> tuple[bool, int | None]:
    """Graceful stop first: console commands let MTA shut down cleanly (the
    module's ShutdownModule runs), then force-kill after a grace period.

    Returns (graceful, returncode); graceful is False when a kill was needed.
    """
    graceful = False
    try:
        if server.poll() is None:
            server.send("exit")
            # A shutdown worker may still be running: the SDK joins active
            # workers in ShutdownModule (safe shutdown), so the
            # graceful window must outlast the 60 s scenario worker.
            try:
                server.wait(timeout=120)
                out("Server shut down gracefully (console exit)")
                return True, server.returncode
            except subprocess.TimeoutExpired:
                pass
            server.send("q")
            try:
                server.wait(timeout=20)
                out("Server shut down gracefully (console Q)")
                return True, server.returncode
            except subprocess.TimeoutExpired:
                pass
            server.kill()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    except (OSError, subprocess.TimeoutExpired):
        pass
    except Exception as err:  # noqa: BLE001 - log, don't mask a stop-logic bug
        out(f"stop_process: unexpected {type(err).__name__}: {err}")
    return graceful, server.returncode


# --- entry ------------------------------------------------------------------


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    if command == "install":
        return cmd_install(update=False)
    if command == "update":
        return cmd_install(update=True)
    if command == "version":
        return cmd_version()
    if command == "start":
        return cmd_start()
    if command == "stop":
        return cmd_stop()
    if command == "test":
        return cmd_test(None)
    out(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))