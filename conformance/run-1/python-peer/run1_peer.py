"""Independent stdlib-only FLOW Run/1 host peer used by conformance tests."""

from __future__ import annotations

import json
import math
import os
import re
import select
import subprocess
import tempfile
import time
from collections.abc import Mapping, Sequence
from typing import Any


MAX_FRAME_BYTES = 16_777_216
MAX_DEPTH = 128
MAX_NODES = 262_144
MAX_CONTAINER_ENTRIES = 65_536
MAX_STRING_BYTES = 8_388_608
MAX_MEMBER_NAME_BYTES = 1_024
MAX_NUMBER_TOKEN_BYTES = 128
MAX_SAFE_INTEGER = 9_007_199_254_740_991

_WIRE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
_LOCAL_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_STANDARD_ERROR_CODES = {-32700, -32600, -32601, -32602, -32603}
_OPERATION_ERROR_CODES = {
    "CANCELLED",
    "DEADLINE_EXCEEDED",
    "OWNER_CLOSED",
    "OPERATION_CONFLICT",
    "UNAVAILABLE",
    "PERMISSION_DENIED",
    "RESOURCE_EXHAUSTED",
    "INVALID_INPUT",
    "INVALID_RESULT",
    "UNCERTAIN",
    "EXECUTION_FAILED",
}


class Json1Error(ValueError):
    """A value or frame is outside FLOW JSON/1."""


class ProtocolError(RuntimeError):
    """The component violated the exercised Run/1 protocol."""


def _parse_number(token: str) -> int | float:
    if len(token) > MAX_NUMBER_TOKEN_BYTES:
        raise Json1Error("number token exceeds the JSON/1 limit")
    value = float(token)
    if not math.isfinite(value):
        raise Json1Error("number is not finite binary64")
    if value.is_integer():
        if abs(value) > MAX_SAFE_INTEGER:
            raise Json1Error("integral number exceeds the safe range")
        return int(value)
    return value


def _reject_constant(token: str) -> None:
    raise Json1Error(f"non-JSON number token: {token}")


def _object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise Json1Error(f"duplicate object member: {key!r}")
        result[key] = value
    return result


def _string_size(value: str, limit: int) -> None:
    try:
        size = len(value.encode("utf-8", "strict"))
    except UnicodeEncodeError as error:
        raise Json1Error("lone Unicode surrogate") from error
    if size > limit:
        raise Json1Error("string exceeds the JSON/1 limit")


def normalize_json1(value: Any) -> Any:
    """Validate a value and copy it into ordinary JSON containers."""

    nodes = 0
    active: set[int] = set()

    def visit(current: Any, depth: int) -> Any:
        nonlocal nodes
        if depth > MAX_DEPTH:
            raise Json1Error("value exceeds the JSON/1 depth limit")
        nodes += 1
        if nodes > MAX_NODES:
            raise Json1Error("value exceeds the JSON/1 node limit")

        if current is None or isinstance(current, bool):
            return current
        if isinstance(current, str):
            _string_size(current, MAX_STRING_BYTES)
            return current
        if isinstance(current, int):
            if abs(current) > MAX_SAFE_INTEGER:
                raise Json1Error("integral number exceeds the safe range")
            return current
        if isinstance(current, float):
            if not math.isfinite(current):
                raise Json1Error("number is not finite binary64")
            if current.is_integer():
                if abs(current) > MAX_SAFE_INTEGER:
                    raise Json1Error("integral number exceeds the safe range")
                return int(current)
            return current

        identity = id(current)
        if identity in active:
            raise Json1Error("cyclic value")
        if isinstance(current, Mapping):
            if len(current) > MAX_CONTAINER_ENTRIES:
                raise Json1Error("object exceeds the member limit")
            active.add(identity)
            try:
                result: dict[str, Any] = {}
                for key, child in current.items():
                    if not isinstance(key, str):
                        raise Json1Error("object member names must be strings")
                    _string_size(key, MAX_MEMBER_NAME_BYTES)
                    result[key] = visit(child, depth + 1)
                return result
            finally:
                active.remove(identity)
        if isinstance(current, (list, tuple)):
            if len(current) > MAX_CONTAINER_ENTRIES:
                raise Json1Error("array exceeds the item limit")
            active.add(identity)
            try:
                return [visit(child, depth + 1) for child in current]
            finally:
                active.remove(identity)
        raise Json1Error(f"unsupported JSON value: {type(current).__name__}")

    return visit(value, 1)


def decode_json1(payload: bytes) -> Any:
    if not payload:
        raise Json1Error("empty JSON/1 document")
    if len(payload) > MAX_FRAME_BYTES:
        raise Json1Error("document exceeds the frame limit")
    if payload.startswith(b"\xef\xbb\xbf"):
        raise Json1Error("UTF-8 BOM is forbidden")
    try:
        text = payload.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise Json1Error("invalid UTF-8") from error
    try:
        value = json.loads(
            text,
            object_pairs_hook=_object_pairs,
            parse_int=_parse_number,
            parse_float=_parse_number,
            parse_constant=_reject_constant,
        )
    except Json1Error:
        raise
    except (TypeError, ValueError, RecursionError) as error:
        raise Json1Error("malformed JSON") from error
    return normalize_json1(value)


def encode_json1(value: Any) -> bytes:
    normalized = normalize_json1(value)
    try:
        payload = json.dumps(
            normalized,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8", "strict")
    except (TypeError, ValueError, UnicodeEncodeError) as error:
        raise Json1Error("value cannot be encoded as JSON/1") from error
    if len(payload) > MAX_FRAME_BYTES:
        raise Json1Error("encoded document exceeds the frame limit")
    return payload


def require_wire_id(value: Any) -> str:
    if not isinstance(value, str) or _WIRE_ID.fullmatch(value) is None:
        raise ProtocolError("invalid Run/1 request ID")
    try:
        size = len(value.encode("ascii"))
    except UnicodeEncodeError as error:
        raise ProtocolError("invalid Run/1 request ID") from error
    if not 1 <= size <= 128:
        raise ProtocolError("invalid Run/1 request ID")
    return value


def require_local_name(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 64 or _LOCAL_NAME.fullmatch(value) is None:
        raise ProtocolError("invalid Run/1 LocalName")
    return value


def require_exact_object(value: Any, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ProtocolError(f"expected exactly object members {sorted(keys)}")
    return value


def _validate_error(value: Any) -> None:
    if not isinstance(value, dict):
        raise ProtocolError("JSON-RPC error must be an object")
    expected = {"code", "message", "data"} if "data" in value else {"code", "message"}
    require_exact_object(value, expected)
    code = value["code"]
    message = value["message"]
    if isinstance(code, bool) or not isinstance(code, int):
        raise ProtocolError("invalid JSON-RPC error code")
    if not isinstance(message, str) or not 1 <= len(message) <= 1_024:
        raise ProtocolError("invalid JSON-RPC error message")
    if code == -32000:
        if "data" not in value:
            raise ProtocolError("operation error is missing data")
        data = value["data"]
        if not isinstance(data, dict) or set(data) not in ({"code"}, {"code", "details"}):
            raise ProtocolError("invalid operation error data")
        if data["code"] not in _OPERATION_ERROR_CODES:
            raise ProtocolError("unknown operation error code")
    elif code not in _STANDARD_ERROR_CODES:
        raise ProtocolError("unknown JSON-RPC error code")


def validate_envelope(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("jsonrpc") != "2.0":
        raise ProtocolError("invalid JSON-RPC envelope")
    has_method = "method" in value
    has_id = "id" in value
    has_result = "result" in value
    has_error = "error" in value

    if has_method:
        if not isinstance(value["method"], str):
            raise ProtocolError("invalid JSON-RPC method")
        expected = {"jsonrpc", "method"}
        if has_id:
            expected.add("id")
            require_wire_id(value["id"])
        if "params" in value:
            if not isinstance(value["params"], (dict, list)):
                raise ProtocolError("JSON-RPC params must be an object or array")
            expected.add("params")
        require_exact_object(value, expected)
        return value

    if not has_id or has_result == has_error:
        raise ProtocolError("invalid JSON-RPC response")
    expected = {"jsonrpc", "id", "result" if has_result else "error"}
    require_exact_object(value, expected)
    if value["id"] is None:
        if not has_error:
            raise ProtocolError("success response cannot use a null ID")
    else:
        require_wire_id(value["id"])
    if has_error:
        _validate_error(value["error"])
    return value


class HostPeer:
    """Blocking host-side Run/1 subprocess peer with bounded frame reads."""

    def __init__(
        self,
        command: Sequence[str],
        *,
        environment: Mapping[str, str] | None = None,
        timeout: float = 5.0,
    ) -> None:
        merged_environment = os.environ.copy()
        if environment is not None:
            merged_environment.update(environment)
        self._diagnostics = tempfile.TemporaryFile(mode="w+b")
        try:
            self._process = subprocess.Popen(
                list(command),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                # Run/1 permits diagnostics. A file cannot fill up like an
                # undrained pipe while the component is still running.
                stderr=self._diagnostics,
                env=merged_environment,
                bufsize=0,
            )
        except BaseException:
            self._diagnostics.close()
            raise
        if self._process.stdin is None or self._process.stdout is None:
            self._process.kill()
            self._diagnostics.close()
            raise RuntimeError("subprocess pipes were not created")
        self._stdin = self._process.stdin
        self._stdout = self._process.stdout
        self._timeout = timeout
        self._buffer = bytearray()
        self._component_ids: set[str] = set()
        self._closed_input = False

    def __enter__(self) -> HostPeer:
        return self

    def __exit__(self, _kind: Any, _value: Any, _traceback: Any) -> None:
        self.dispose()

    def send(self, message: Mapping[str, Any]) -> None:
        self.send_bytes(encode_json1(message) + b"\n")

    def send_bytes(self, payload: bytes) -> None:
        try:
            self._stdin.write(payload)
            self._stdin.flush()
        except (BrokenPipeError, OSError, ValueError) as error:
            raise ProtocolError("component protocol input is closed") from error

    def receive(self, *, timeout: float | None = None) -> dict[str, Any]:
        deadline = time.monotonic() + (self._timeout if timeout is None else timeout)
        while True:
            newline = self._buffer.find(b"\n")
            if newline >= 0:
                payload = bytes(self._buffer[:newline])
                del self._buffer[: newline + 1]
                return validate_envelope(decode_json1(payload))
            if len(self._buffer) > MAX_FRAME_BYTES:
                raise ProtocolError("component emitted an oversized frame")

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("timed out waiting for a component frame")
            ready, _, _ = select.select([self._stdout.fileno()], [], [], remaining)
            if not ready:
                raise TimeoutError("timed out waiting for a component frame")
            chunk = os.read(self._stdout.fileno(), 65_536)
            if not chunk:
                if self._buffer:
                    raise ProtocolError("component stdout ended with an incomplete frame")
                raise ProtocolError("component stdout closed before the expected frame")
            self._buffer.extend(chunk)

    def receive_request(self, expected_method: str) -> dict[str, Any]:
        return self.validate_request(self.receive(), expected_method)

    def validate_request(
        self,
        message: dict[str, Any],
        expected_method: str,
    ) -> dict[str, Any]:
        if message.get("method") != expected_method or "id" not in message:
            raise ProtocolError(f"expected {expected_method} request")
        request_id = require_wire_id(message["id"])
        if request_id in self._component_ids:
            raise ProtocolError("component reused a request ID")
        self._component_ids.add(request_id)
        return message

    def close_input(self) -> None:
        if self._closed_input:
            return
        self._closed_input = True
        try:
            self._stdin.close()
        except (BrokenPipeError, OSError):
            pass

    def finish(self) -> None:
        self.close_input()
        try:
            exit_code = self._process.wait(timeout=self._timeout)
        except subprocess.TimeoutExpired as error:
            self._process.kill()
            self._process.wait()
            raise TimeoutError("component did not exit after its root response") from error
        remaining = bytes(self._buffer) + self._stdout.read()
        if exit_code != 0:
            diagnostics = self._read_diagnostics()
            raise ProtocolError(f"component exited {exit_code}: {diagnostics}")
        if remaining:
            raise ProtocolError("component emitted unexpected bytes after its root response")

    def dispose(self) -> None:
        self.close_input()
        if self._process.poll() is None:
            self._process.kill()
        try:
            self._process.wait(timeout=self._timeout)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait()
        self._stdout.close()
        self._diagnostics.close()

    def _read_diagnostics(self) -> str:
        self._diagnostics.flush()
        self._diagnostics.seek(0)
        return self._diagnostics.read().decode("utf-8", "replace")


def flow_run_request(request_id: str, input_value: Any) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": require_wire_id(request_id),
        "method": "flow/run",
        "params": {
            "protocol": "run/1",
            "input": normalize_json1(input_value),
            "settings": {},
            "attachments": {},
            "scratch": "/tmp/flow-run-1",
            "deadlineUnixMs": 4_000_000_000_000,
        },
    }


def cancellation(request_id: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "method": "request/cancel",
        "params": {"requestId": require_wire_id(request_id)},
    }


def success(request_id: str, result: Any) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": require_wire_id(request_id),
        "result": normalize_json1(result),
    }
