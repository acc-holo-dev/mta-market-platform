"""Unit tests for the pure helper functions of the server harness and CLI.

Run with:  python -m unittest discover -s tests/module
No third-party dependencies (stdlib unittest only). These cover the pure,
side-effect-free helpers; the real-server integration is exercised separately
by `mta test integration` (Windows + Linux in CI).
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # tests/module/test_harness.py -> platform root
sys.path.insert(0, str(ROOT / "module" / "tools" / "mock-server"))
sys.path.insert(0, str(ROOT / "module" / "tools" / "mta"))

import mta_server  # noqa: E402
import cli  # noqa: E402


class FindServerExeTest(unittest.TestCase):
    def test_finds_linux_bare_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            exe = base / "mtasa" / "mta-server64"
            exe.parent.mkdir(parents=True)
            exe.touch()
            self.assertEqual(mta_server.find_server_exe(base), exe)

    def test_finds_windows_exe(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            exe = base / "server" / "MTA Server64.exe"
            exe.parent.mkdir(parents=True)
            exe.touch()
            self.assertEqual(mta_server.find_server_exe(base), exe)

    def test_returns_none_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(mta_server.find_server_exe(Path(tmp)))


class ServerArgsTest(unittest.TestCase):
    def test_windows_uses_test_flag(self):
        self.assertEqual(mta_server.server_args("windows"), ["-t"])

    def test_linux_takes_no_flags(self):
        self.assertEqual(mta_server.server_args("linux"), [])


class PinnedBuildTest(unittest.TestCase):
    def test_selects_host_platform(self):
        pinned = mta_server.pinned_build()
        expected = "windows" if os.name == "nt" else "linux"
        self.assertEqual(pinned["platform"], expected)
        self.assertIn("expected_sha256", pinned)
        self.assertIn("url", pinned)


class EnsureDefaultAclTest(unittest.TestCase):
    def test_creates_acl_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            mods = Path(tmp) / "mods" / "deathmatch"
            mods.mkdir(parents=True)
            mta_server.ensure_default_acl(mods)
            acl = mods / "acl.xml"
            self.assertTrue(acl.is_file())
            self.assertIn("<acl>", acl.read_text(encoding="utf-8"))

    def test_does_not_overwrite_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            mods = Path(tmp) / "mods" / "deathmatch"
            mods.mkdir(parents=True)
            acl = mods / "acl.xml"
            acl.write_text("<acl>custom</acl>", encoding="utf-8")
            mta_server.ensure_default_acl(mods)
            self.assertEqual(acl.read_text(encoding="utf-8"), "<acl>custom</acl>")


class OutputBinaryTest(unittest.TestCase):
    def _config(self):
        return {"module": {"name": "base"}}

    def test_windows_arch_uses_dll(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            arch = root / "build" / "p" / "module" / "win-x64"
            arch.mkdir(parents=True)
            (arch / "base.dll").touch()
            result = cli.output_binary(root, "p", self._config())
            self.assertEqual(result, arch / "base.dll")

    def test_linux_arch_uses_so(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            arch = root / "build" / "p" / "module" / "linux-x64"
            arch.mkdir(parents=True)
            (arch / "base.so").touch()
            result = cli.output_binary(root, "p", self._config())
            self.assertEqual(result, arch / "base.so")

    def test_returns_none_when_not_built(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(cli.output_binary(Path(tmp), "p", self._config()))

    def test_ambiguous_arch_dirs_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            module = root / "build" / "p" / "module"
            (module / "win-x64").mkdir(parents=True)
            (module / "win-arm64").mkdir()
            with self.assertRaises(SystemExit):
                cli.output_binary(root, "p", self._config())


if __name__ == "__main__":
    unittest.main()
