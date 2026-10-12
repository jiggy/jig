"""Packed Jig saved-web smoke: real PTYs, public HTTP, sanitized evidence only.

Usage: python3 installed-saved-web.py INSTALLED_JIG PACKET_DIRECTORY
The caller owns the temporary directory and hides OpenTUI for this invocation.
Python is test tooling only; no product source, private API or browser is loaded.
"""

import errno
import hashlib
from html.parser import HTMLParser
import http.client
import json
import os
from pathlib import Path
import pty
import re
import selectors
import signal
import subprocess
import sys
import time


OUTPUT_LIMIT = 256 * 1024
HTTP_LIMIT = 8 * 1024 * 1024
LINK = re.compile(rb"http://127\.0\.0\.1:(\d+)/#cap=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])")
CHECKS = [
    "embedded-assets", "bearer-required", "recorded-capture",
    "immutable-previews", "exact-origin-close", "piped-input",
    "joined-exit", "capability-redaction",
]


def require(condition):
    if not condition:
        raise AssertionError("installed saved-web check failed")


def interrupted(_signum, _frame):
    raise InterruptedError("installed saved-web helper interrupted")


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.styles = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and "src" in values:
            require(values.get("type") == "module")
            self.scripts.append(values["src"])
        if tag == "link" and values.get("rel") == "stylesheet":
            self.styles.append(values.get("href"))


class TerminalOwner:
    def __init__(self, command):
        self.selector = selectors.DefaultSelector()
        self.output = {"stdout": bytearray(), "stderr": bytearray()}
        self.process = None
        slaves = []
        try:
            for name in self.output:
                master, slave = pty.openpty()
                slaves.append(slave)
                os.set_blocking(master, False)
                self.selector.register(master, selectors.EVENT_READ, name)
            self.process = subprocess.Popen(
                command, stdin=subprocess.PIPE, stdout=slaves[0], stderr=slaves[1],
                start_new_session=True,
                env=dict(os.environ, NO_COLOR="1", TERM="dumb"),
            )
            # EOF and arbitrary pipe bytes must not act as inspector controls.
            self.process.stdin.write(b"piped input is not an inspector command\n")
            self.process.stdin.close()
        except BaseException:
            self.close()
            raise
        finally:
            for slave in slaves:
                os.close(slave)

    def pump(self, seconds=0.05):
        for key, _ in self.selector.select(seconds):
            try:
                chunk = os.read(key.fd, 65536)
            except OSError as error:
                if error.errno not in (errno.EIO, errno.EBADF):
                    raise
                chunk = b""
            if not chunk:
                self.selector.unregister(key.fd)
                os.close(key.fd)
                continue
            require(len(self.output[key.data]) + len(chunk) <= OUTPUT_LIMIT)
            self.output[key.data].extend(chunk)

    def wait(self, deadline):
        while self.process.poll() is None or self.selector.get_map():
            require(time.monotonic() < deadline)
            self.pump()
        return self.process.wait()

    def close(self):
        if self.process is not None:
            if self.process.poll() is None:
                try:
                    os.killpg(self.process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(self.process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    self.process.wait(timeout=5)
            if self.process.stdin is not None and not self.process.stdin.closed:
                self.process.stdin.close()
        for key in list(self.selector.get_map().values()):
            self.selector.unregister(key.fd)
            os.close(key.fd)
        self.selector.close()


def sanitize(data, capability):
    text = bytes(data).decode("utf-8", "replace").replace("\r\n", "\n")
    text = re.sub(r"http://127\.0\.0\.1:\d+/#cap=[A-Za-z0-9_-]*", "[local inspector link]", text)
    if capability:
        text = text.replace(capability, "[redacted capability]")
    # Also redact an isolated capability if activation failed before link parsing.
    return re.sub(r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])", "[redacted capability]", text)


def main():
    # This fixture owns a new directory. Use its canonical temporary parent;
    # macOS /var aliases are links which confined result capture must refuse.
    packet = Path(sys.argv[2]).resolve()
    packet.mkdir(parents=True)
    files = packet / "files"
    files.mkdir()
    contents = {
        "notes.txt": b"Captured document intake evidence.\n",
        "review.patch": b"--- a/intake.txt\n+++ b/intake.txt\n@@ -1 +1 @@\n-missing\n+received\n",
        "empty.txt": b"",
        "binary.dat": bytes([255, 0, 254, 128]),
        "long.txt": b"LONG_CAPTURE_BEGIN\n" + b"x" * (70 * 1024) + b"\nLONG_CAPTURE_END\n",
    }
    manifest = []
    for name, data in contents.items():
        (files / name).write_bytes(data)
        manifest.append({"path": name, "bytes": len(data), "digest": "sha256:" + hashlib.sha256(data).hexdigest()})
    record = {
        "status": "succeeded", "outcome": "done",
        "output": {"summary": "Synthetic document intake checked; no legal advice."},
        "diagnostics": {"stderr": "RECORDED_INTAKE_DIAGNOSTIC\n", "stderrBytes": len(b"RECORDED_INTAKE_DIAGNOSTIC\n"), "stderrTruncated": False},
        "delivery": {"status": "written", "destination": str(packet), "files": manifest},
    }
    report = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    (packet / "result.json").write_bytes(report)
    owner = None
    capability = ""
    phase = "launch"
    succeeded = False
    exit_code = None
    deadline = time.monotonic() + 60
    previous_signals = {
        number: signal.signal(number, interrupted)
        for number in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        owner = TerminalOwner([sys.argv[1], "inspect", "--result", str(packet), "--display", "web"])
        link = None
        while link is None:
            require(time.monotonic() < deadline and owner.process.poll() is None)
            owner.pump()
            link = LINK.search(owner.output["stderr"])
        port = int(link.group(1))
        capability = link.group(2).decode("ascii")
        origin = "http://127.0.0.1:" + str(port)

        def request(path, authorization=False, method="GET", origin_header=None):
            require(time.monotonic() < deadline)
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=min(3, deadline - time.monotonic()))
            try:
                headers = {}
                if authorization:
                    headers["Authorization"] = "Bearer " + capability
                if origin_header is not None:
                    headers["Origin"] = origin_header
                connection.request(method, path, headers=headers)
                response = connection.getresponse()
                body = response.read(HTTP_LIMIT + 1)
                require(len(body) <= HTTP_LIMIT and capability.encode() not in body)
                return response.status, {name.lower(): value for name, value in response.getheaders()}, body
            finally:
                connection.close()

        phase = "embedded-assets"
        status, headers, html = request("/")
        require(status == 200 and headers.get("content-type", "").startswith("text/html"))
        require(headers.get("cache-control") == "no-store")
        require("script-src 'self'" in headers.get("content-security-policy", ""))
        assets = Assets()
        assets.feed(html.decode("utf-8"))
        require(bool(assets.scripts) and bool(assets.styles))
        for paths, content_type in [(assets.scripts, "text/javascript"), (assets.styles, "text/css")]:
            for path in paths:
                require(isinstance(path, str) and re.fullmatch(r"/assets/[A-Za-z0-9_.-]+", path))
                status, headers, body = request(path)
                require(status == 200 and len(body) > 0)
                require(headers.get("content-type", "").startswith(content_type))
                require(headers.get("cache-control") == "no-store")

        phase = "bearer-required"
        require(request("/api/snapshot")[0] == 403)
        status, _, body = request("/api/snapshot", True)
        require(status == 200)
        snapshot = json.loads(body)
        phase = "recorded-capture"
        require(snapshot["kind"] == "snapshot" and snapshot["mode"] == "recorded-packet")
        require(snapshot["workspace"]["phase"] == "settled")
        capture = snapshot["artifacts"]
        require(capture["phase"] == "ready" and capture["provenance"] == "recorded-capture")
        inventory = {entry["path"]: entry for entry in capture["files"]}
        require(set(inventory) == set(contents))
        require(str(packet).encode() not in body)
        require(owner.process.poll() is None)  # Piped stdin EOF did not leave.

        phase = "immutable-previews"
        # Mutate every source before the first preview request, not after a cache hit.
        for name in contents:
            (files / name).write_bytes(b"MUTATED_DESTINATION_BYTES\n")
        for name, data in contents.items():
            entry = inventory[name]
            require(re.fullmatch(r"[0-9a-f]{64}", entry["id"]))
            status, _, body = request("/api/artifacts/" + entry["id"] + "/preview", True)
            require(status == 200)
            preview = json.loads(body)
            require(preview["artifactId"] == entry["id"])
            require(preview["captureGeneration"] == capture["generation"])
            require(preview["provenance"] == "recorded-capture" and preview["bytes"] == len(data))
            state = "non-text" if name == "binary.dat" else "empty" if not data else "text"
            require(entry["state"] == state and preview["state"] == state)
            require(entry["clipped"] == (name == "long.txt") and preview["clipped"] == (name == "long.txt"))
            if state == "non-text":
                require("text" not in preview)
            else:
                require(preview["text"] == data[:65536].decode("utf-8"))
        require(owner.process.poll() is None)

        phase = "exact-origin-close"
        require(request("/api/close", True, "POST")[0] == 403)
        require(request("/api/close", True, "POST", "http://127.0.0.1:1")[0] == 403)
        require(request("/api/snapshot", True)[0] == 200)
        status, _, body = request("/api/close", True, "POST", origin)
        require(status == 200 and json.loads(body) == {"closed": True})
        phase = "joined-exit"
        exit_code = owner.wait(deadline)
        require(exit_code == 0)
        phase = "capability-redaction"
        require((packet / "result.json").read_bytes() == report and capability.encode() not in report)
        stdout = bytes(owner.output["stdout"])
        stderr = bytes(owner.output["stderr"])
        require(capability.encode() not in stdout)
        require(stderr.count(capability.encode()) == 1)
        require(capability.encode() not in stderr.replace(link.group(0), b"[local inspector link]"))
        require(b"RECORDED_INTAKE_DIAGNOSTIC" in stdout + stderr)
        succeeded = True
    except BaseException:
        # Exceptions can contain request headers/URLs; retain only our fixed phase.
        pass
    finally:
        # Finish the one bounded join even if the caller interrupts repeatedly.
        for number in previous_signals:
            signal.signal(number, signal.SIG_IGN)
        if owner is not None:
            owner.close()
            exit_code = owner.process.returncode
        evidence = {
            "passed": succeeded, "phase": phase, "code": exit_code,
            "stdout": sanitize(owner.output["stdout"] if owner else b"", capability),
            "stderr": sanitize(owner.output["stderr"] if owner else b"", capability),
        }
        encoded_evidence = json.dumps(evidence, ensure_ascii=False) + "\n"
        require(not capability or capability not in encoded_evidence)
        (packet.parent / "saved-web-smoke-transcript.json").write_text(encoded_evidence)
        for number, handler in previous_signals.items():
            signal.signal(number, handler)
    if not succeeded:
        print(json.dumps({"passed": False, "phase": phase, "code": exit_code}))
        return 1
    print(json.dumps({"passed": True, "checks": CHECKS}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
