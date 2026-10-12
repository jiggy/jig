"""Packed Jig saved TUI: actual terminal navigation, capture and restoration.

Usage: python3 installed-saved-tui.py INSTALLED_JIG PACKET_DIRECTORY
The packet contains synthetic recorded claims; it is not execution evidence.
Only fixed checks leave this helper. No product source or private API is loaded.
"""

import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import selectors
import signal
import struct
import subprocess
import sys
import termios
import time


OUTPUT_LIMIT = 256 * 1024
CHECKS = [
    "native-screen", "recorded-files", "captured-preview", "joined-close",
    "screen-restored", "input-restored",
]


def require(condition):
    if not condition:
        raise AssertionError("installed saved-tui check failed")


def interrupted(_signum, _frame):
    raise InterruptedError("installed saved-tui helper interrupted")


def main():
    packet = Path(sys.argv[2]).resolve()
    packet.mkdir(parents=True)
    files = packet / "files"
    files.mkdir()
    captured = b"FROZEN_TUI_PREVIEW_ONLY\n"
    (files / "notes.txt").write_bytes(captured)
    record = {
        "status": "succeeded", "outcome": "done",
        "output": {"summary": "Recorded terminal display witness"},
        "delivery": {"status": "written", "destination": str(packet), "files": [
            {"path": "notes.txt", "bytes": len(captured),
             "digest": "sha256:" + hashlib.sha256(captured).hexdigest()},
        ]},
    }
    report = (json.dumps(record, separators=(",", ":")) + "\n").encode()
    (packet / "result.json").write_bytes(report)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 140, 0, 0))
    os.set_blocking(master, False)
    selector = selectors.DefaultSelector()
    selector.register(master, selectors.EVENT_READ)
    output = bytearray()
    child = None
    phase = "launch"
    previous_signals = {
        number: signal.signal(number, interrupted)
        for number in (signal.SIGINT, signal.SIGTERM)
    }
    # The retained session owner observes its own attributes after Jig exits;
    # a parent-side tcgetattr after Darwin retires the session is not evidence.
    owner = """
import os, subprocess, sys, termios
before = termios.tcgetattr(0)
child = subprocess.Popen(sys.argv[1:])
code = child.wait()
assert termios.tcgetattr(0) == before
os.write(2, b'\\nTUI_OWNER_INPUT_RESTORED\\n')
sys.exit(code if code >= 0 else 128-code)
"""
    deadline = time.monotonic() + 60

    def pump():
        require(time.monotonic() < deadline)
        for key, _ in selector.select(0.05):
            try:
                chunk = os.read(key.fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                chunk = b""
            if chunk:
                require(len(output) + len(chunk) <= OUTPUT_LIMIT)
                output.extend(chunk)

    def wait_for(value, start=0):
        while value not in output[start:]:
            require(child.poll() is None)
            pump()

    try:
        child = subprocess.Popen(
            [sys.executable, "-c", owner, sys.argv[1], "inspect", "--result", str(packet),
             "--display", "tui"],
            stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
            env=dict(os.environ, TERM="xterm-256color", NO_COLOR="1"),
        )
        phase = "screen"
        wait_for(b"\x1b[?1049h")
        wait_for(b"Recorded result")
        # Saved inspection has Recorded result, Captured files, Diagnostics;
        # one public Tab advances to files. Await its rendered acknowledgement
        # before Enter rather than batching live-view chooser keystrokes.
        phase = "files"
        start = len(output)
        os.write(master, b"\t")
        wait_for(b"[Captured files]", start)
        wait_for(b"notes.txt", start)
        # Capture precedes mutation. Preview must retain the accepted bytes.
        (files / "notes.txt").write_bytes(b"MUTATED_TUI_SOURCE_MUST_NOT_APPEAR\n")
        phase = "preview"
        start = len(output)
        os.write(master, b"\r")
        wait_for(b"FROZEN_TUI_PREVIEW_ONLY", start)
        require(b"MUTATED_TUI_SOURCE_MUST_NOT_APPEAR" not in output)
        # q requests read-only exit, with Stay selected. Observe each public
        # acknowledgement before choosing Leave and confirming the close.
        phase = "exit-confirmation"
        start = len(output)
        os.write(master, b"q")
        wait_for(b"Leave the TUI?", start)
        wait_for(b"[Stay]", start)
        require(b"[Leave]" not in output[start:])
        phase = "exit-selection"
        start = len(output)
        os.write(master, b"\x1b[C")
        wait_for(b"[Leave]", start)
        phase = "close"
        os.write(master, b"\r")
        while child.poll() is None:
            pump()
        # A retained slave prevents EOF; drain the already exited owner directly.
        while True:
            try:
                chunk = os.read(master, 65536)
            except BlockingIOError:
                break
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
            if not chunk:
                break
            require(len(output) + len(chunk) <= OUTPUT_LIMIT)
            output.extend(chunk)
        require(child.wait(timeout=1) == 0)
        require(output.count(b"\x1b[?1049h") == 1)
        require(output.count(b"\x1b[?1049l") == 1)
        require(output.index(b"\x1b[?1049h") < output.index(b"\x1b[?1049l"))
        require(b"TUI_OWNER_INPUT_RESTORED" in output)
        require((packet / "result.json").read_bytes() == report)
        print(json.dumps({"passed": True, "checks": CHECKS}, separators=(",", ":")))
    except BaseException:
        # Terminal bodies may contain capabilities or arbitrary reported data.
        # Retain only the fixed phase; do not expose them through assertion causes.
        raise AssertionError("installed saved-tui check failed during " + phase) from None
    finally:
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=5)
        for number, handler in previous_signals.items():
            signal.signal(number, handler)
        selector.close()
        os.close(master)
        os.close(slave)


if __name__ == "__main__":
    main()
