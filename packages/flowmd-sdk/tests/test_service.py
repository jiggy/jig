from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time
import unittest


PACKAGE = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).with_name("fixture_service.py")


def frame(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode() + b"\n"


class Provider:
    def __init__(self) -> None:
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(PACKAGE / "src")
        self.process = subprocess.Popen(
            [sys.executable, str(FIXTURE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
        )

    def send(self, value: object) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(frame(value))
        self.process.stdin.flush()

    def receive(self, timeout: float = 5) -> dict[str, object]:
        assert self.process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(self.process.stdout, selectors.EVENT_READ)
        try:
            if not selector.select(timeout):
                self.fail("timed out waiting for Provider output")
            line = self.process.stdout.readline()
        finally:
            selector.close()
        if not line:
            self.fail("Provider closed stdout")
        return json.loads(line)

    def wait(self, expected: int = 0) -> None:
        try:
            code = self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.fail("Provider did not exit")
        if code != expected:
            self.fail(f"Provider exited {code}, expected {expected}")

    def fail(self, message: str) -> None:
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        assert self.process.stderr is not None
        diagnostics = self.process.stderr.read().decode(errors="replace")
        raise AssertionError(f"{message}\nstderr:\n{diagnostics}")

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream is not None:
                stream.close()


def mount() -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "id": "host:1",
        "method": "service/mount",
        "params": {
            "protocol": "service/1",
            "settings": {},
            "attachments": {},
            "scratch": "/scratch",
            "startupDeadlineUnixMs": int(time.time() * 1000) + 10_000,
        },
    }


def invoke(request_id: str, method: str, input_value: object) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "service/invoke",
        "params": {
            "export": "sessions",
            "method": method,
            "input": input_value,
            "deadlineUnixMs": int(time.time() * 1000) + 10_000,
        },
    }


def cancel(request_id: str) -> dict[str, object]:
    return {"jsonrpc": "2.0", "method": "request/cancel", "params": {"requestId": request_id}}


class ServiceRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = Provider()

    def tearDown(self) -> None:
        self.provider.close()

    def ready(self) -> None:
        self.provider.send(mount())
        readiness = self.provider.receive()
        self.assertEqual(readiness["method"], "service/ready")
        self.assertEqual(readiness["params"], {"ownerRequestId": "host:1", "exports": ["sessions"]})
        self.provider.send({"jsonrpc": "2.0", "id": readiness["id"], "result": {}})

    def stop(self) -> None:
        self.provider.send(cancel("host:1"))
        self.assertEqual(self.provider.receive(), {"jsonrpc": "2.0", "id": "host:1", "result": {}})
        self.provider.wait()

    def test_mount_invocation_errors_ownership_and_cleanup(self) -> None:
        self.ready()
        self.provider.send(invoke("host:2", "echo", {"value": 1}))
        self.assertEqual(self.provider.receive(), {
            "jsonrpc": "2.0",
            "id": "host:2",
            "result": {"value": {"value": 1}},
        })

        self.provider.send(invoke("host:3", "missing", {"session": "s-1"}))
        self.assertEqual(self.provider.receive()["result"], {
            "error": {"name": "not-found", "data": {"session": "s-1"}},
        })

        self.provider.send(invoke("host:4", "dependency", {"key": "s-2"}))
        dependency = self.provider.receive()
        self.assertEqual(dependency["method"], "effect/call")
        self.assertEqual(dependency["params"]["ownerRequestId"], "host:4")
        self.provider.send({
            "jsonrpc": "2.0",
            "id": dependency["id"],
            "error": {"code": -32000, "message": "unavailable", "data": {"code": "UNAVAILABLE"}},
        })
        self.assertEqual(self.provider.receive()["error"]["data"]["code"], "UNAVAILABLE")
        self.stop()

    def test_invocation_cancellation_does_not_cancel_sibling(self) -> None:
        self.ready()
        self.provider.send(invoke("host:2", "slow", None))
        self.provider.send(invoke("host:3", "echo", "fast"))
        self.assertEqual(self.provider.receive(), {
            "jsonrpc": "2.0", "id": "host:3", "result": {"value": "fast"}
        })
        self.provider.send(cancel("host:2"))
        cancelled = self.provider.receive()
        self.assertEqual(cancelled["id"], "host:2")
        self.assertEqual(cancelled["error"]["data"]["code"], "CANCELLED")
        self.stop()

    def test_invocation_before_readiness_is_fatal(self) -> None:
        self.provider.send(mount())
        readiness = self.provider.receive()
        self.provider.send(invoke("host:2", "echo", None))
        diagnostic = self.provider.receive()
        self.assertEqual(diagnostic["id"], "host:2")
        self.assertEqual(diagnostic["error"]["code"], -32600)
        self.provider.wait(expected=1)
        self.assertIsNotNone(readiness)


if __name__ == "__main__":
    unittest.main()
