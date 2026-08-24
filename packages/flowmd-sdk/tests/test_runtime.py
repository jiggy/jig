from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time
import unittest

from flowmd_sdk import OperationError, RunContext


PACKAGE = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).with_name("fixture_component.py")


def frame(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode() + b"\n"


class Component:
    def __init__(self) -> None:
        env = os.environ.copy()
        source = str(PACKAGE / "src")
        env["PYTHONPATH"] = source + os.pathsep + env.get("PYTHONPATH", "")
        self.process = subprocess.Popen(
            [sys.executable, str(FIXTURE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )

    def send(self, value: object) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(frame(value))
        self.process.stdin.flush()

    def send_raw(self, value: bytes) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(value)
        self.process.stdin.flush()

    def receive(self, timeout: float = 5) -> dict[str, object]:
        assert self.process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(self.process.stdout, selectors.EVENT_READ)
        try:
            if not selector.select(timeout):
                self.fail_with_diagnostics("timed out waiting for a protocol frame")
            line = self.process.stdout.readline()
        finally:
            selector.close()
        if not line:
            self.fail_with_diagnostics("component closed stdout before a protocol frame")
        return json.loads(line)

    def has_output(self, timeout: float = 0.15) -> bool:
        assert self.process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(self.process.stdout, selectors.EVENT_READ)
        try:
            return bool(selector.select(timeout))
        finally:
            selector.close()

    def remaining_stdout(self) -> bytes:
        assert self.process.stdout is not None
        return self.process.stdout.read()

    def remaining_stderr(self) -> bytes:
        assert self.process.stderr is not None
        return self.process.stderr.read()

    def close_input(self) -> None:
        assert self.process.stdin is not None
        self.process.stdin.close()

    def wait(self, expected: int = 0) -> None:
        try:
            code = self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
            self.fail_with_diagnostics("component did not exit")
        if code != expected:
            self.fail_with_diagnostics(f"component exited {code}, expected {expected}")

    def fail_with_diagnostics(self, message: str) -> None:
        assert self.process.stderr is not None
        self.process.kill()
        self.process.wait()
        diagnostics = self.process.stderr.read().decode(errors="replace")
        raise AssertionError(f"{message}\nstderr:\n{diagnostics}")

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream is not None:
                stream.close()


def root_request(mode: str) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "id": "host:1",
        "method": "flow/run",
        "params": {
            "protocol": "run/1",
            "input": {"mode": mode},
            "settings": {},
            "attachments": {},
            "scratch": "/tmp/flow-scratch",
            "deadlineUnixMs": int(time.time() * 1000) + 10_000,
        },
    }


class RuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.component = Component()

    def tearDown(self) -> None:
        self.component.close()

    def test_operation_error_constructor_matches_shared_surface(self) -> None:
        error = OperationError("INVALID_INPUT", "bad input", {"field": "name"})
        self.assertEqual(error.code, "INVALID_INPUT")
        self.assertEqual(str(error), "bad input")
        self.assertEqual(error.details, {"field": "name"})
        self.assertEqual(str(OperationError("INVALID_INPUT", "")), "")

    def test_public_run_context_is_not_constructible(self) -> None:
        with self.assertRaises(TypeError):
            RunContext()  # type: ignore[abstract]
        self.assertNotIn("_client", getattr(RunContext, "__annotations__", {}))

    def test_returns_one_root_result(self) -> None:
        self.component.send(root_request("echo"))
        response = self.component.receive()
        self.assertEqual(response["id"], "host:1")
        self.assertEqual(
            response["result"],
            {"outcome": "done", "output": {"mode": "echo"}},
        )
        self.component.wait()

    def test_deadline_is_context_not_a_python_timer(self) -> None:
        request = root_request("echo")
        params = request["params"]
        assert isinstance(params, dict)
        params["deadlineUnixMs"] = 0
        self.component.send(request)
        response = self.component.receive()
        self.assertEqual(response["result"]["outcome"], "done")
        self.component.wait()

    def test_full_duplex_flow_and_effect_calls(self) -> None:
        self.component.send(root_request("calls"))

        child = self.component.receive()
        self.assertEqual(child["method"], "flow/call")
        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "result": {"outcome": "done", "output": {"answer": 42}},
            }
        )

        effect = self.component.receive()
        self.assertEqual(effect["method"], "effect/call")
        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": effect["id"],
                "result": {
                    "error": {"name": "not-found", "data": {"key": "missing"}}
                },
            }
        )

        response = self.component.receive()
        self.assertEqual(
            response["result"],
            {
                "outcome": "done",
                "output": {
                    "child": {"outcome": "done", "output": {"answer": 42}},
                    "effect": {"name": "not-found", "data": {"key": "missing"}},
                },
            },
        )
        self.component.wait()

    def test_json_rpc_error_message_scalar_limit(self) -> None:
        self.component.send(root_request("calls"))
        child = self.component.receive()
        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "error": {
                    "code": -32000,
                    "message": "\N{GRINNING FACE}" * 1_024,
                    "data": {"code": "INVALID_INPUT"},
                },
            }
        )
        response = self.component.receive()
        self.assertEqual(response["error"]["data"]["code"], "INVALID_INPUT")
        self.component.wait()

        self.component.close()
        self.component = Component()
        self.component.send(root_request("calls"))
        child = self.component.receive()
        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "error": {
                    "code": -32000,
                    "message": "\N{GRINNING FACE}" * 1_025,
                    "data": {"code": "INVALID_INPUT"},
                },
            }
        )
        self.component.wait(expected=1)
        self.assertEqual(self.component.remaining_stdout(), b"")

    def test_root_cancellation_cancels_handler(self) -> None:
        self.component.send(root_request("cancel"))
        self.component.send(
            {
                "jsonrpc": "2.0",
                "method": "request/cancel",
                "params": {"requestId": "host:1"},
            }
        )
        response = self.component.receive()
        self.assertEqual(response["error"]["data"]["code"], "CANCELLED")
        self.component.wait()

    def test_swallowed_root_cancellation_still_wins_and_closes_admission(self) -> None:
        for index, mode in enumerate(("swallow-cancel", "swallow-cancel-error")):
            if index:
                self.component.close()
                self.component = Component()
            self.component.send(root_request(mode))
            self.component.send(
                {
                    "jsonrpc": "2.0",
                    "method": "request/cancel",
                    "params": {"requestId": "host:1"},
                }
            )
            response = self.component.receive()
            self.assertNotIn("method", response)
            self.assertEqual(response["error"]["data"]["code"], "CANCELLED")
            self.component.wait()

    def test_parallel_requests_accept_reverse_order_responses(self) -> None:
        self.component.send(root_request("parallel"))
        first = self.component.receive()
        second = self.component.receive()
        requests = {first["method"]: first, second["method"]: second}
        self.assertEqual(set(requests), {"flow/call", "effect/call"})

        effect = requests["effect/call"]
        self.component.send(
            {"jsonrpc": "2.0", "id": effect["id"], "result": {"value": "stored"}}
        )
        child = requests["flow/call"]
        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "result": {"outcome": "done", "output": "child"},
            }
        )

        response = self.component.receive()
        self.assertEqual(
            response["result"],
            {"outcome": "done", "output": {"child": "child", "effect": "stored"}},
        )
        self.component.wait()

    def test_native_task_cancellation_emits_protocol_cancellation(self) -> None:
        self.component.send(root_request("cancel-call"))
        child = self.component.receive()
        self.assertEqual(child["method"], "flow/call")
        cancellation = self.component.receive()
        self.assertEqual(cancellation["method"], "request/cancel")
        self.assertEqual(cancellation["params"], {"requestId": child["id"]})

        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "error": {
                    "code": -32000,
                    "message": "cancelled",
                    "data": {"code": "CANCELLED"},
                },
            }
        )
        response = self.component.receive()
        self.assertEqual(
            response["result"],
            {"outcome": "done", "output": "cancelled-locally"},
        )
        self.component.wait()

    def test_root_cancellation_waits_for_owned_wire_response(self) -> None:
        self.component.send(root_request("cancel-pending"))
        child = self.component.receive()
        self.component.send(
            {
                "jsonrpc": "2.0",
                "method": "request/cancel",
                "params": {"requestId": "host:1"},
            }
        )
        cancellation = self.component.receive()
        self.assertEqual(cancellation["params"], {"requestId": child["id"]})
        self.assertFalse(self.component.has_output())

        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "error": {
                    "code": -32000,
                    "message": "cancelled",
                    "data": {"code": "CANCELLED"},
                },
            }
        )
        response = self.component.receive()
        self.assertEqual(response["error"]["data"]["code"], "CANCELLED")
        self.component.wait()
        self.assertEqual(self.component.remaining_stderr(), b"")

    def test_detached_call_prevents_root_success(self) -> None:
        self.component.send(root_request("detached"))
        child = self.component.receive()
        cancellation = self.component.receive()
        self.assertEqual(cancellation["params"], {"requestId": child["id"]})
        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "error": {
                    "code": -32000,
                    "message": "owner closed",
                    "data": {"code": "OWNER_CLOSED"},
                },
            }
        )
        response = self.component.receive()
        self.assertEqual(response["error"]["data"]["code"], "EXECUTION_FAILED")
        self.component.wait()

    def test_root_cancel_cannot_interrupt_committed_failure_quiescence(self) -> None:
        self.component.send(root_request("error-with-detached"))
        child = self.component.receive()
        cancellation = self.component.receive()
        self.assertEqual(cancellation["params"], {"requestId": child["id"]})

        self.component.send(
            {
                "jsonrpc": "2.0",
                "method": "request/cancel",
                "params": {"requestId": "host:1"},
            }
        )
        self.assertFalse(self.component.has_output())
        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "error": {
                    "code": -32000,
                    "message": "owner closed",
                    "data": {"code": "OWNER_CLOSED"},
                },
            }
        )
        response = self.component.receive()
        self.assertEqual(response["error"]["data"]["code"], "INVALID_INPUT")
        self.assertEqual(response["error"]["message"], "committed failure")
        self.component.wait()

    def test_unhandled_operation_error_preserves_wire_code(self) -> None:
        self.component.send(root_request("operation-error"))
        response = self.component.receive()
        self.assertEqual(response["error"]["data"]["code"], "INVALID_INPUT")
        self.assertEqual(response["error"]["data"]["details"], {"field": "input"})
        self.assertEqual(response["error"]["message"], "The input is not usable.")
        self.component.wait()

    def test_invalid_operation_error_details_become_execution_failure(self) -> None:
        self.component.send(root_request("invalid-operation-details"))
        response = self.component.receive()
        self.assertEqual(response["error"]["data"], {"code": "EXECUTION_FAILED"})
        self.component.wait()

    def test_malformed_or_local_operation_errors_are_downgraded(self) -> None:
        modes = (
            "empty-operation-message",
            "long-operation-message",
            "surrogate-operation-message",
            "local-operation-code",
            "unhashable-operation-code",
        )
        for index, mode in enumerate(modes):
            if index:
                self.component.close()
                self.component = Component()
            self.component.send(root_request(mode))
            response = self.component.receive()
            self.assertEqual(
                response["error"],
                {
                    "code": -32000,
                    "message": "EXECUTION_FAILED",
                    "data": {"code": "EXECUTION_FAILED"},
                },
            )
            self.component.wait()

    def test_standard_json_rpc_error_for_outbound_call_is_fatal(self) -> None:
        self.component.send(root_request("calls"))
        child = self.component.receive()
        self.component.send(
            {
                "jsonrpc": "2.0",
                "id": child["id"],
                "error": {"code": -32603, "message": "Internal error"},
            }
        )
        self.component.wait(expected=1)
        self.assertEqual(self.component.remaining_stdout(), b"")

    def test_diagnostic_encoding_cannot_override_execution_failure(self) -> None:
        for index, mode in enumerate(("bad-diagnostic", "large-diagnostic")):
            if index:
                self.component.close()
                self.component = Component()
            self.component.send(root_request(mode))
            response = self.component.receive()
            self.assertEqual(response["error"]["data"]["code"], "EXECUTION_FAILED")
            self.component.wait()

    def test_duplicate_member_gets_parse_error_then_close(self) -> None:
        self.component.send_raw(b'{"jsonrpc":"2.0","jsonrpc":"2.0"}\n')
        response = self.component.receive()
        self.assertEqual(response["id"], None)
        self.assertEqual(response["error"]["code"], -32700)
        self.component.wait(expected=1)

    def test_utf8_bom_gets_parse_error_then_close(self) -> None:
        self.component.send_raw(b'\xef\xbb\xbf{"jsonrpc":"2.0"}\n')
        response = self.component.receive()
        self.assertEqual(response["error"]["code"], -32700)
        self.component.wait(expected=1)

    def test_deep_json_gets_parse_error_instead_of_crashing_reader(self) -> None:
        self.component.send_raw(b"[" * 2_000 + b"0" + b"]" * 2_000 + b"\n")
        response = self.component.receive()
        self.assertEqual(response["error"]["code"], -32700)
        self.component.wait(expected=1)

    def test_invalid_utf8_closes_silently(self) -> None:
        self.component.send_raw(b"\xff\n")
        self.component.wait(expected=1)
        self.assertEqual(self.component.remaining_stdout(), b"")

    def test_incomplete_frame_closes_silently(self) -> None:
        self.component.send_raw(b'{"jsonrpc":"2.0"}')
        self.component.close_input()
        self.component.wait(expected=1)
        self.assertEqual(self.component.remaining_stdout(), b"")

    def test_unknown_response_fatally_closes_without_root_error(self) -> None:
        self.component.send(root_request("calls"))
        self.component.receive()
        self.component.send(
            {"jsonrpc": "2.0", "id": "component:unknown", "result": None}
        )
        self.component.wait(expected=1)
        self.assertEqual(self.component.remaining_stdout(), b"")


if __name__ == "__main__":
    unittest.main()
