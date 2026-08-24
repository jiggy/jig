from __future__ import annotations

import os
import shutil
import sys
import unittest
from pathlib import Path
from typing import Any

from run1_peer import (
    HostPeer,
    Json1Error,
    ProtocolError,
    cancellation,
    decode_json1,
    encode_json1,
    flow_run_request,
    require_exact_object,
    require_local_name,
    success,
)


ROOT = Path(__file__).resolve().parents[3]
RUN_1 = ROOT / "conformance" / "run-1"
INPUT = {"subject": "football"}


class Json1CodecTests(unittest.TestCase):
    def test_round_trip_and_negative_zero_normalization(self) -> None:
        self.assertEqual(
            decode_json1(encode_json1({"nested": [True, None, "✓"], "zero": -0.0})),
            {"nested": [True, None, "✓"], "zero": 0},
        )

    def test_rejects_duplicate_members_bom_and_invalid_utf8(self) -> None:
        for payload in (b'{"x":1,"x":2}', b"\xef\xbb\xbf{}", b"\xff"):
            with self.subTest(payload=payload), self.assertRaises(Json1Error):
                decode_json1(payload)

    def test_rejects_unsafe_numbers_and_lone_surrogates(self) -> None:
        with self.assertRaises(Json1Error):
            decode_json1(b"9007199254740992")
        with self.assertRaises(Json1Error):
            decode_json1(b'"\\ud800"')
        with self.assertRaises(Json1Error):
            encode_json1("\ud800")


class HostPeerTransportTests(unittest.TestCase):
    def test_stderr_diagnostics_are_drained_and_permitted(self) -> None:
        program = """
import sys
sys.stderr.write("x" * (1024 * 1024))
sys.stderr.flush()
sys.stdout.write('{"jsonrpc":"2.0","id":"host:1","result":null}\\n')
sys.stdout.flush()
"""
        with HostPeer([sys.executable, "-c", program]) as peer:
            self.assertEqual(
                peer.receive(),
                {"jsonrpc": "2.0", "id": "host:1", "result": None},
            )
            peer.finish()


class GoldenConversationTests(unittest.TestCase):
    def test_typescript_sdk_component(self) -> None:
        bun = shutil.which("bun")
        if bun is None:
            self.skipTest("bun is unavailable")
        trace = exercise([bun, str(RUN_1 / "components" / "flow.ts")])
        self.assertEqual(trace, expected_trace())

    def test_python_sdk_component(self) -> None:
        python_path = str(ROOT / "packages" / "flowmd-sdk" / "src")
        environment = {
            "PYTHONPATH": os.pathsep.join(
                part
                for part in (python_path, os.environ.get("PYTHONPATH", ""))
                if part
            ),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        trace = exercise(
            [sys.executable, str(RUN_1 / "components" / "flow.py")],
            environment=environment,
        )
        self.assertEqual(trace, expected_trace())


def exercise(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    trace: list[dict[str, Any]] = []
    with HostPeer(command, environment=environment) as peer:
        # Unknown and duplicate cancellation targets are deliberate no-ops.
        peer.send(cancellation("stale:1"))
        peer.send(cancellation("stale:1"))
        peer.send(flow_run_request("host:1", INPUT))
        trace.append({"direction": "host->component", "kind": "request", "method": "flow/run"})

        first = peer.receive()
        second = peer.receive()
        calls = {message.get("method"): message for message in (first, second)}
        if set(calls) != {"flow/call", "effect/call"}:
            raise ProtocolError("component did not issue the expected concurrent calls")
        # Normalize these concurrent siblings by meaning; Run/1 does not make
        # their scheduler-dependent wire order part of conformance.
        flow_call = require_call(
            peer,
            calls["flow/call"],
            method="flow/call",
            fields={"operationId", "slot", "intent", "input"},
        )
        effect_call = require_call(
            peer,
            calls["effect/call"],
            method="effect/call",
            fields={"operationId", "slot", "method", "input"},
        )
        self_equal(flow_call["params"], {
            "operationId": "research:1",
            "slot": "research",
            "intent": "Find a useful comparison target.",
            "input": INPUT,
        })
        self_equal(effect_call["params"], {
            "operationId": "store:1",
            "slot": "artifacts",
            "method": "write",
            "input": {"source": "research"},
        })
        trace.extend([
            {
                "direction": "component->host",
                "kind": "request",
                "method": "flow/call",
                "operationId": "research:1",
            },
            {
                "direction": "component->host",
                "kind": "request",
                "method": "effect/call",
                "operationId": "store:1",
            },
        ])

        peer.send(success(effect_call["id"], {"value": {"uri": "artifact://1"}}))
        trace.append({"direction": "host->component", "kind": "result", "for": "effect/call"})
        peer.send(
            success(
                flow_call["id"],
                {"outcome": "done", "output": {"answer": "Fifa 99"}},
            )
        )
        trace.append({"direction": "host->component", "kind": "result", "for": "flow/call"})

        missing = peer.receive()
        missing = require_call(
            peer,
            missing,
            method="effect/call",
            fields={"operationId", "slot", "method", "input"},
        )
        self_equal(missing["params"], {
            "operationId": "missing:1",
            "slot": "artifacts",
            "method": "read",
            "input": {"uri": "artifact://missing"},
        })
        trace.append({
            "direction": "component->host",
            "kind": "request",
            "method": "effect/call",
            "operationId": "missing:1",
        })
        peer.send(
            success(
                missing["id"],
                {"error": {"name": "not-found", "data": {"uri": "artifact://missing"}}},
            )
        )
        trace.append({
            "direction": "host->component",
            "kind": "result",
            "for": "effect/call",
            "declaredError": "not-found",
        })

        root_response = peer.receive()
        require_exact_object(root_response, {"jsonrpc", "id", "result"})
        if root_response["id"] != "host:1":
            raise ProtocolError("root response used the wrong request ID")
        result = require_exact_object(root_response["result"], {"outcome", "output"})
        require_local_name(result["outcome"])
        self_equal(result, {
            "outcome": "done",
            "output": {
                "research": {"outcome": "done", "output": {"answer": "Fifa 99"}},
                "stored": {"uri": "artifact://1"},
                "missing": "not-found",
            },
        })
        trace.append({"direction": "component->host", "kind": "result", "for": "flow/run"})
        peer.finish()
    return trace


def require_call(
    peer: HostPeer,
    message: dict[str, Any],
    *,
    method: str,
    fields: set[str],
) -> dict[str, Any]:
    peer.validate_request(message, method)
    params = require_exact_object(message.get("params"), fields)
    require_local_name(params["slot"])
    return message


def self_equal(actual: Any, expected: Any) -> None:
    if actual != expected:
        raise AssertionError(f"expected {expected!r}, received {actual!r}")


def expected_trace() -> Any:
    return decode_json1((RUN_1 / "fixtures" / "golden-trace.json").read_bytes())


if __name__ == "__main__":
    unittest.main()
