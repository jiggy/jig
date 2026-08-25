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
    validate_envelope,
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
    def test_rejects_scalar_and_null_request_params(self) -> None:
        for params in (None, "not-structured"):
            with self.subTest(params=params), self.assertRaises(ProtocolError):
                validate_envelope({
                    "jsonrpc": "2.0",
                    "id": "host:bad-params",
                    "method": "flow/run",
                    "params": params,
                })

    def test_rejects_scalar_and_null_notification_params(self) -> None:
        for params in (None, False):
            with self.subTest(params=params), self.assertRaises(ProtocolError):
                validate_envelope({
                    "jsonrpc": "2.0",
                    "method": "request/cancel",
                    "params": params,
                })

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

    def test_trailing_output_and_nonzero_exit_invalidate_completion(self) -> None:
        response = encode_json1({
            "jsonrpc": "2.0",
            "id": "host:1",
            "result": {"outcome": "done", "output": None},
        }) + b"\n"
        programs = {
            "trailing output": (
                response
                + encode_json1({
                    "jsonrpc": "2.0",
                    "id": "host:extra",
                    "result": None,
                })
                + b"\n",
                0,
            ),
            "partial trailing output": (response + b"partial", 0),
            "nonzero exit": (response, 7),
        }
        for name, (payload, exit_code) in programs.items():
            program = (
                "import sys; "
                f"sys.stdout.buffer.write({payload!r}); "
                "sys.stdout.buffer.flush(); "
                f"sys.exit({exit_code})"
            )
            with self.subTest(name=name), HostPeer([sys.executable, "-c", program]) as peer:
                self.assertEqual(
                    peer.receive(),
                    {
                        "jsonrpc": "2.0",
                        "id": "host:1",
                        "result": {"outcome": "done", "output": None},
                    },
                )
                with self.assertRaises(ProtocolError):
                    peer.finish()

    def test_large_trailing_output_is_drained_before_exit(self) -> None:
        response = encode_json1({
            "jsonrpc": "2.0",
            "id": "host:1",
            "result": {"outcome": "done", "output": None},
        }) + b"\n"
        program = (
            "import sys; "
            f"sys.stdout.buffer.write({response!r}); "
            "sys.stdout.buffer.write(b'x' * (2 * 1024 * 1024)); "
            "sys.stdout.buffer.flush()"
        )
        with HostPeer([sys.executable, "-c", program]) as peer:
            self.assertEqual(
                peer.receive(),
                {
                    "jsonrpc": "2.0",
                    "id": "host:1",
                    "result": {"outcome": "done", "output": None},
                },
            )
            with self.assertRaisesRegex(ProtocolError, "unexpected bytes"):
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


class ExpandedComponentMatrixTests(unittest.TestCase):
    def test_typescript_component_matrix(self) -> None:
        bun = shutil.which("bun")
        if bun is None:
            self.skipTest("bun is unavailable")
        standard = [bun, str(RUN_1 / "components" / "flow.ts")]
        command = [bun, str(RUN_1 / "components" / "matrix.ts")]
        exercise_standard_component_matrix(standard)
        exercise_terminal_half_close(command)
        exercise_call_cancellation(command)
        exercise_abandoned_call(command)
        exercise_request_ceiling(command)
        exercise_operation_identity(command)
        exercise_response_failures(command)
        exercise_malicious_65([
            bun,
            str(RUN_1 / "components" / "malicious-65.ts"),
        ])

    def test_python_component_matrix(self) -> None:
        python_path = str(ROOT / "packages" / "flowmd-sdk" / "src")
        environment = {
            "PYTHONPATH": os.pathsep.join(
                part
                for part in (python_path, os.environ.get("PYTHONPATH", ""))
                if part
            ),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        standard = [sys.executable, str(RUN_1 / "components" / "flow.py")]
        command = [sys.executable, str(RUN_1 / "components" / "matrix.py")]
        exercise_standard_component_matrix(standard, environment=environment)
        exercise_terminal_half_close(command, environment=environment)
        exercise_call_cancellation(command, environment=environment)
        exercise_abandoned_call(command, environment=environment)
        exercise_request_ceiling(command, environment=environment)
        exercise_operation_identity(command, environment=environment)
        exercise_response_failures(command, environment=environment)


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


def exercise_standard_component_matrix(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
) -> None:
    with HostPeer(command, environment=environment) as peer:
        wrong_requests = ("request/cancel", "flow/call", "effect/call")
        for index, method in enumerate(wrong_requests):
            request_id = f"host:wrong:{index}"
            params = {"requestId": "host:none"} if method == "request/cancel" else {}
            peer.send({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            })
            expect_standard_error(peer.receive(), request_id, -32601)

        for method in ("flow/run", "flow/call", "effect/call", "unknown/event"):
            peer.send({"jsonrpc": "2.0", "method": method, "params": {}})
        peer.send({
            "jsonrpc": "2.0",
            "id": "host:end",
            "method": "flow/run",
            "params": {},
        })
        expect_standard_error(peer.receive(), "host:end", -32602)
        expect_closed(peer)

    for _name, params in invalid_root_params():
        with HostPeer(command, environment=environment) as peer:
            peer.send({
                "jsonrpc": "2.0",
                "id": "host:bad-root",
                "method": "flow/run",
                "params": params,
            })
            expect_standard_error(peer.receive(), "host:bad-root", -32602)
            expect_closed(peer)

    with HostPeer(command, environment=environment) as peer:
        peer.send(flow_run_request("host:1", {}))
        peer.send(flow_run_request("host:2", {}))
        second_root_error = None
        for _ in range(4):
            message = peer.receive()
            if message.get("id") == "host:2":
                second_root_error = message
                break
        if second_root_error is None:
            raise AssertionError("component did not reject the second root Run")
        expect_standard_error(second_root_error, "host:2", -32600)
        expect_closed(peer)

    with HostPeer(command, environment=environment) as peer:
        peer.send(flow_run_request("host:cancel", {}))
        requests = [peer.receive(), peer.receive()]
        for request in requests:
            method = request.get("method")
            if method not in {"flow/call", "effect/call"}:
                raise AssertionError(f"unexpected owned request: {request!r}")
            peer.validate_request(request, method)

        peer.send(cancellation("host:cancel"))
        peer.send(cancellation("host:cancel"))
        cancelled_ids = sorted(cancel_target(peer.receive()) for _ in range(2))
        self_equal(cancelled_ids, sorted(request["id"] for request in requests))
        expect_no_frame(peer)

        for request in requests:
            result = (
                {"outcome": "done", "output": None}
                if request["method"] == "flow/call"
                else {"value": None}
            )
            peer.send(success(request["id"], result))
        expect_operation_error(peer.receive(), "host:cancel", "CANCELLED")
        peer.finish()

    fatal_frames = (
        ("complete invalid JSON", b'{"jsonrpc":\n', -32700),
        ("parsed batch", b"[]\n", -32600),
        ("invalid UTF-8", b"\xff\n", None),
    )
    for _name, payload, response_code in fatal_frames:
        with HostPeer(command, environment=environment) as peer:
            peer.send_bytes(payload)
            if response_code is not None:
                expect_standard_error(peer.receive(), None, response_code)
            expect_closed(peer)


def exercise_terminal_half_close(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
) -> None:
    with HostPeer(command, environment=environment) as peer:
        peer.send(flow_run_request("host:half-close", {}))
        response = peer.receive()

        self_equal(response, {
            "jsonrpc": "2.0",
            "id": "host:half-close",
            "result": {"outcome": "done", "output": None},
        })
        peer.close_input()
        peer.finish()


def exercise_call_cancellation(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
) -> None:
    with HostPeer(command, environment=environment) as peer:
        peer.send(flow_run_request("host:call-cancel", {"case": "cancel-one-call"}))
        child, release = receive_child_and_release(peer)
        peer.send(success(release["id"], {"value": None}))
        self_equal(cancel_target(peer.receive()), child["id"])
        expect_no_frame(peer)

        peer.send(success(
            child["id"],
            {"outcome": "done", "output": "late-success"},
        ))
        self_equal(peer.receive(), {
            "jsonrpc": "2.0",
            "id": "host:call-cancel",
            "result": {"outcome": "done", "output": "cancelled-locally"},
        })
        peer.finish()


def exercise_abandoned_call(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
) -> None:
    with HostPeer(command, environment=environment) as peer:
        peer.send(flow_run_request("host:abandoned", {"case": "abandoned-call"}))
        child, release = receive_child_and_release(peer)
        peer.send(success(release["id"], {"value": None}))
        self_equal(cancel_target(peer.receive()), child["id"])
        expect_no_frame(peer)

        peer.send(success(
            child["id"],
            {"outcome": "done", "output": "late-success"},
        ))
        expect_operation_error(peer.receive(), "host:abandoned", "EXECUTION_FAILED")
        peer.finish()


def exercise_request_ceiling(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
) -> None:
    with HostPeer(command, environment=environment) as peer:
        peer.send(flow_run_request("host:fanout", {"case": "fanout-65"}))
        pending = [peer.receive_request("effect/call") for _ in range(64)]
        self_equal(len({request["id"] for request in pending}), 64)
        expect_no_frame(peer)

        for request in pending:
            peer.send(success(request["id"], {"value": None}))

        next_message = peer.receive()
        if next_message.get("method") == "effect/call":
            queued = peer.validate_request(next_message, "effect/call")
            peer.send(success(queued["id"], {"value": None}))
            root = peer.receive()
        else:
            root = next_message
        self_equal(root, {
            "jsonrpc": "2.0",
            "id": "host:fanout",
            "result": {"outcome": "done", "output": {"settled": 65}},
        })
        peer.finish()


def exercise_operation_identity(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
) -> None:
    with HostPeer(command, environment=environment) as peer:
        peer.send(flow_run_request("host:identity", {"case": "operation-identity"}))
        operations = ReferenceOperations()
        first = peer.receive_request("effect/call")
        second = peer.receive_request("effect/call")
        self_equal(operations.admit(first), {"kind": "dispatch"})
        self_equal(operations.admit(second), {"kind": "join"})
        self_equal(operations.dispatches, 1)

        shared_result = {"value": {"receipt": "shared"}}
        for response in operations.settle("shared:1", shared_result):
            peer.send(response)

        replay = peer.receive_request("effect/call")
        self_equal(operations.admit(replay), {"kind": "replay", "result": shared_result})
        peer.send(success(replay["id"], shared_result))

        conflict = peer.receive_request("effect/call")
        self_equal(operations.admit(conflict), {"kind": "conflict"})
        peer.send(operation_error(conflict["id"], "OPERATION_CONFLICT"))
        self_equal(operations.dispatches, 1)

        root = peer.receive()
        self_equal(root, {
            "jsonrpc": "2.0",
            "id": "host:identity",
            "result": {
                "outcome": "done",
                "output": {
                    "first": {"receipt": "shared"},
                    "second": {"receipt": "shared"},
                    "replay": {"receipt": "shared"},
                    "conflict": "OPERATION_CONFLICT",
                },
            },
        })
        peer.finish()


def exercise_response_failures(
    command: list[str],
    *,
    environment: dict[str, str] | None = None,
) -> None:
    cases = (
        ("unknown response", {"jsonrpc": "2.0", "id": "component:unknown", "result": None}),
        ("malformed child", None),
        ("standard child error", None),
    )
    for name, fixed_response in cases:
        with HostPeer(command, environment=environment) as peer:
            peer.send(flow_run_request("host:failure", {"case": "one-flow"}))
            child = peer.receive_request("flow/call")
            if fixed_response is not None:
                response = fixed_response
            elif name == "malformed child":
                response = success(child["id"], {"outcome": "done"})
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": child["id"],
                    "error": {"code": -32603, "message": "Internal error"},
                }
            peer.send(response)
            try:
                peer.receive()
            except ProtocolError:
                pass
            else:
                raise AssertionError(f"{name} did not close the component channel")

    with HostPeer(command, environment=environment) as peer:
        peer.send(flow_run_request("host:duplicate", {"case": "two-effects"}))
        first = peer.receive_request("effect/call")
        peer.send(success(first["id"], {"value": "first"}))
        peer.receive_request("effect/call")
        peer.send(success(first["id"], {"value": "duplicate"}))
        try:
            peer.receive()
        except ProtocolError:
            pass
        else:
            raise AssertionError("duplicate response did not close the component channel")


def exercise_malicious_65(command: list[str]) -> None:
    with HostPeer(command) as peer:
        peer.send(flow_run_request("host:malicious", {}))
        dispatched = [peer.receive_request("effect/call") for _ in range(64)]
        rejected = peer.receive_request("effect/call")
        peer.send(operation_error(rejected["id"], "RESOURCE_EXHAUSTED"))
        self_equal(len(dispatched), 64)
        for request in dispatched:
            peer.send(success(request["id"], {"value": None}))
        self_equal(peer.receive(), {
            "jsonrpc": "2.0",
            "id": "host:malicious",
            "result": {
                "outcome": "done",
                "output": {"accepted": 64, "rejected": 1},
            },
        })
        peer.finish()


class ReferenceOperations:
    def __init__(self) -> None:
        self.records: dict[str, dict[str, Any]] = {}
        self.dispatches = 0

    def admit(self, request: dict[str, Any]) -> dict[str, Any]:
        params = request["params"]
        operation_id = params["operationId"]
        signature = {
            "method": request["method"],
            "params": {key: value for key, value in params.items() if key != "operationId"},
        }
        prior = self.records.get(operation_id)
        if prior is None:
            self.records[operation_id] = {
                "signature": signature,
                "waiters": [request["id"]],
            }
            self.dispatches += 1
            return {"kind": "dispatch"}
        if prior["signature"] != signature:
            return {"kind": "conflict"}
        if "result" in prior:
            return {"kind": "replay", "result": prior["result"]}
        prior["waiters"].append(request["id"])
        return {"kind": "join"}

    def settle(self, operation_id: str, result: Any) -> list[dict[str, Any]]:
        record = self.records[operation_id]
        record["result"] = result
        waiters = record["waiters"]
        record["waiters"] = []
        return [success(request_id, result) for request_id in waiters]


def operation_error(request_id: str, code: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {
            "code": -32000,
            "message": code,
            "data": {"code": code},
        },
    }


def invalid_root_params() -> list[tuple[str, dict[str, Any]]]:
    valid = dict(flow_run_request("host:template", {})["params"])
    missing = dict(valid)
    del missing["scratch"]
    unknown = {**valid, "unknown": True}
    wrong_protocol = {**valid, "protocol": "run/2"}
    excessive_attachments = {
        **valid,
        "attachments": {
            f"a{index}": {"path": "/x", "access": "read"}
            for index in range(257)
        },
    }
    return [
        ("missing field", missing),
        ("unknown field", unknown),
        ("wrong protocol", wrong_protocol),
        ("257 attachments", excessive_attachments),
    ]


def receive_child_and_release(
    peer: HostPeer,
) -> tuple[dict[str, Any], dict[str, Any]]:
    messages = [peer.receive(), peer.receive()]
    calls: dict[str, dict[str, Any]] = {}
    for message in messages:
        method = message.get("method")
        if method not in {"flow/call", "effect/call"}:
            raise AssertionError(f"unexpected call: {message!r}")
        calls[method] = peer.validate_request(message, method)
    if set(calls) != {"flow/call", "effect/call"}:
        raise AssertionError(f"expected child and release calls, received {calls!r}")
    child = calls["flow/call"]
    release = calls["effect/call"]
    if child["params"]["slot"] != "child":
        raise AssertionError("cancellation fixture used the wrong child slot")
    if release["params"]["slot"] != "control":
        raise AssertionError("cancellation fixture used the wrong release slot")
    return child, release


def cancel_target(message: dict[str, Any]) -> str:
    require_exact_object(message, {"jsonrpc", "method", "params"})
    if message["jsonrpc"] != "2.0" or message["method"] != "request/cancel":
        raise AssertionError(f"expected cancellation, received {message!r}")
    params = require_exact_object(message["params"], {"requestId"})
    request_id = params["requestId"]
    if not isinstance(request_id, str):
        raise AssertionError("cancellation target is not a string")
    return request_id


def expect_no_frame(peer: HostPeer) -> None:
    try:
        peer.receive(timeout=0.075)
    except TimeoutError:
        return
    raise AssertionError("component emitted a root response before wire quiescence")


def expect_closed(peer: HostPeer) -> None:
    try:
        peer.receive(timeout=1.0)
    except ProtocolError:
        return
    raise AssertionError("component protocol channel remained open")


def expect_standard_error(
    message: dict[str, Any],
    request_id: str | None,
    code: int,
) -> None:
    require_exact_object(message, {"jsonrpc", "id", "error"})
    if message["jsonrpc"] != "2.0" or message["id"] != request_id:
        raise AssertionError(f"error response used the wrong envelope: {message!r}")
    error = message["error"]
    if not isinstance(error, dict) or error.get("code") != code:
        raise AssertionError(f"expected standard error {code}, received {message!r}")
    if not isinstance(error.get("message"), str):
        raise AssertionError("standard error message is not a string")


def expect_operation_error(
    message: dict[str, Any],
    request_id: str,
    code: str,
) -> None:
    require_exact_object(message, {"jsonrpc", "id", "error"})
    if message["jsonrpc"] != "2.0" or message["id"] != request_id:
        raise AssertionError(f"operation error used the wrong envelope: {message!r}")
    error = message["error"]
    if not isinstance(error, dict) or error.get("code") != -32000:
        raise AssertionError(f"expected operation error, received {message!r}")
    data = error.get("data")
    if not isinstance(data, dict) or data.get("code") != code:
        raise AssertionError(f"expected operation error {code}, received {message!r}")


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
