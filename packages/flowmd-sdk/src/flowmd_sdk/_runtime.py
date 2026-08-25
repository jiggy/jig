from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys
import threading
import traceback
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ._json import (
    MAX_DOCUMENT_BYTES,
    MAX_SAFE_INTEGER,
    Json1Error,
    encode_json1,
    normalize_json1,
    parse_json1,
)
from ._types import (
    Attachment,
    EffectError,
    JsonValue,
    OperationError,
    OperationErrorCode,
    RunContext,
    RunHandler,
    RunResult,
)


_WIRE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
_LOCAL_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_FLOW_ERROR_CODES = frozenset(
    {
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
)
_STANDARD_ERROR_CODES = frozenset({-32700, -32600, -32601, -32602, -32603})
_QUEUE_LIMIT = 1
_OUTSTANDING_LIMIT = 64


class _InvalidParams(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class _EndOfFile:
    incomplete: bool = False


@dataclass(frozen=True, slots=True)
class _FrameFailure:
    response_code: int | None
    message: str
    local_code: OperationErrorCode = "PROTOCOL_ERROR"


@dataclass(slots=True)
class _Pending:
    kind: str
    future: asyncio.Future[Any]
    cancel_sent: bool = False
    user_cancelled: bool = False


@dataclass(frozen=True, slots=True)
class _RunContextImpl:
    input: JsonValue
    settings: Mapping[str, JsonValue]
    attachments: Mapping[str, Attachment]
    scratch: str
    deadline_unix_ms: int
    _client: _Runtime

    async def call_flow(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
    ) -> RunResult:
        return await self._client.call_flow(
            operation_id=operation_id,
            slot=slot,
            input=input,
            intent=intent,
        )

    async def call_effect(
        self,
        *,
        operation_id: str,
        slot: str,
        method: str,
        input: JsonValue,
    ) -> JsonValue:
        return await self._client.call_effect(
            operation_id=operation_id,
            slot=slot,
            method=method,
            input=input,
        )


def _is_wire_id(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        encoded = value.encode("ascii")
    except UnicodeEncodeError:
        return False
    return 1 <= len(encoded) <= 128 and _WIRE_ID.fullmatch(value) is not None


def _require_wire_id(value: Any, field: str) -> str:
    if not _is_wire_id(value):
        raise _InvalidParams(f"{field} is not a Run/1 request ID")
    return value


def _require_local_name(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise _InvalidParams(f"{field} must be a LocalName")
    try:
        size = len(value.encode("ascii"))
    except UnicodeEncodeError as error:
        raise _InvalidParams(f"{field} must be a LocalName") from error
    if not (1 <= size <= 64 and _LOCAL_NAME.fullmatch(value)):
        raise _InvalidParams(f"{field} must be a LocalName")
    return value


def _require_exact_object(value: Any, fields: set[str], required: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _InvalidParams("params must be an object")
    keys = set(value)
    if not required.issubset(keys) or not keys.issubset(fields):
        raise _InvalidParams("params contain missing or unknown members")
    return value


def _validate_run_result(value: Any) -> RunResult:
    if isinstance(value, dict) and set(value) == {"outcome", "output"}:
        outcome = value["outcome"]
        output = value["output"]
    else:
        raise _InvalidParams("Run result must contain exactly outcome and output")
    _require_local_name(outcome, "outcome")
    return {"outcome": outcome, "output": normalize_json1(output)}


def _validate_flow_run_params(value: Any) -> tuple[Any, Any, dict[str, Attachment], str, int]:
    params = _require_exact_object(
        value,
        {"protocol", "input", "settings", "attachments", "scratch", "deadlineUnixMs"},
        {"protocol", "input", "settings", "attachments", "scratch", "deadlineUnixMs"},
    )
    if params["protocol"] != "run/1":
        raise _InvalidParams("protocol must be run/1")
    if not isinstance(params["settings"], dict):
        raise _InvalidParams("settings must be an object")
    attachments_value = params["attachments"]
    if not isinstance(attachments_value, dict) or len(attachments_value) > 256:
        raise _InvalidParams("attachments must be an object with at most 256 members")
    attachments: dict[str, Attachment] = {}
    for name, candidate in attachments_value.items():
        _require_local_name(name, "attachment name")
        attachment = _require_exact_object(candidate, {"path", "access"}, {"path", "access"})
        path = attachment["path"]
        access = attachment["access"]
        if not isinstance(path, str) or not path:
            raise _InvalidParams("attachment path must be a nonempty string")
        if access not in {"read", "read-write"}:
            raise _InvalidParams("attachment access must be read or read-write")
        attachments[name] = {"path": path, "access": access}
    scratch = params["scratch"]
    if not isinstance(scratch, str) or not scratch:
        raise _InvalidParams("scratch must be a nonempty string")
    deadline = params["deadlineUnixMs"]
    if isinstance(deadline, bool) or not isinstance(deadline, int):
        raise _InvalidParams("deadlineUnixMs must be a safe integer")
    if not (0 <= deadline <= MAX_SAFE_INTEGER):
        raise _InvalidParams("deadlineUnixMs must be a nonnegative safe integer")
    return (
        normalize_json1(params["input"]),
        normalize_json1(params["settings"]),
        attachments,
        scratch,
        deadline,
    )


def _validate_run_wire_result(value: Any) -> RunResult:
    try:
        return _validate_run_result(value)
    except (Json1Error, _InvalidParams) as error:
        raise _InvalidParams("invalid Run result") from error


def _validate_effect_wire_result(value: Any) -> tuple[str, Any]:
    if not isinstance(value, dict) or len(value) != 1:
        raise _InvalidParams("effect result must contain exactly value or error")
    if "value" in value:
        return "value", normalize_json1(value["value"])
    if "error" not in value:
        raise _InvalidParams("effect result must contain value or error")
    error = _require_exact_object(value["error"], {"name", "data"}, {"name", "data"})
    name = _require_local_name(error["name"], "effect error name")
    return "error", (name, normalize_json1(error["data"]))


def _flow_error_from_wire(value: Any) -> OperationError:
    if not isinstance(value, dict) or set(value) - {"code", "message", "data"}:
        raise _InvalidParams("invalid JSON-RPC error")
    if set(value) < {"code", "message"}:
        raise _InvalidParams("invalid JSON-RPC error")
    code = value["code"]
    message = value["message"]
    if isinstance(code, bool) or not isinstance(code, int):
        raise _InvalidParams("invalid JSON-RPC error code")
    if not isinstance(message, str) or not (1 <= len(message) <= 1_024):
        raise _InvalidParams("invalid JSON-RPC error message")

    if code == -32000:
        if "data" not in value:
            raise _InvalidParams("Run/1 operation error requires data")
        data = _require_exact_object(value["data"], {"code", "details"}, {"code"})
        operation_code = data["code"]
        if operation_code not in _FLOW_ERROR_CODES:
            raise _InvalidParams("unknown Run/1 operation error code")
        details = normalize_json1(data.get("details"))
        return OperationError(operation_code, message=message, details=details)

    if code not in _STANDARD_ERROR_CODES:
        raise _InvalidParams("unknown JSON-RPC error code")
    raise _InvalidParams("standard JSON-RPC errors cannot settle an outbound call")


class _Runtime:
    def __init__(self, handler: RunHandler):
        self._handler = handler
        self._loop: asyncio.AbstractEventLoop | None = None
        self._frames: asyncio.Queue[Any] = asyncio.Queue(maxsize=_QUEUE_LIMIT)
        self._reader_stop = threading.Event()
        self._write_lock = threading.Lock()
        # Guarded by _write_lock. The terminal claimant is chosen at the same
        # boundary which serializes stdout, so a root response and a fatal
        # channel close cannot both publish terminal frames.
        self._terminal_phase = "open"
        self._done = asyncio.Event()
        self._fatal = False
        self._fatal_error: OperationError | None = None
        self._root_id: str | None = None
        self._root_task: asyncio.Task[None] | None = None
        self._root_phase = "absent"
        self._termination_code: OperationErrorCode | None = None
        self._host_ids: set[str] = set()
        self._component_ids: set[str] = set()
        self._next_request_id = 1
        self._pending: dict[str, _Pending] = {}
        self._pending_empty = asyncio.Event()
        self._pending_empty.set()
        self._active_calls = 0
        self._calls_empty = asyncio.Event()
        self._calls_empty.set()
        self._outstanding = asyncio.Semaphore(_OUTSTANDING_LIMIT)
        self._accepting_calls = False

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        reader = threading.Thread(target=self._reader, name="flowmd-run-reader", daemon=True)
        reader.start()
        dispatch = asyncio.create_task(self._dispatch(), name="flowmd-run-dispatch")
        try:
            await self._done.wait()
        finally:
            self._reader_stop.set()
            dispatch.cancel()
            await asyncio.gather(dispatch, return_exceptions=True)
            self._drop_pending("CHANNEL_LOST")
        if self._fatal_error is not None:
            raise self._fatal_error

    def _offer(self, item: Any) -> bool:
        """Move one reader-thread item into the bounded event-loop queue."""

        if self._reader_stop.is_set():
            return False
        try:
            assert self._loop is not None
            asyncio.run_coroutine_threadsafe(self._frames.put(item), self._loop).result()
        except Exception:
            return False
        return True

    def _reader(self) -> None:
        assert self._loop is not None
        descriptor = sys.stdin.fileno()
        buffered = bytearray()
        while not self._reader_stop.is_set():
            try:
                chunk = os.read(descriptor, 65_536)
            except OSError:
                self._offer(_FrameFailure(None, "stdin read failed", "CHANNEL_LOST"))
                return
            if not chunk:
                self._offer_end_of_file(incomplete=bool(buffered))
                return
            buffered.extend(chunk)
            if len(buffered) > MAX_DOCUMENT_BYTES and b"\n" not in buffered:
                self._offer(_FrameFailure(None, "frame exceeds the Run/1 limit"))
                return
            while True:
                newline = buffered.find(b"\n")
                if newline < 0:
                    break
                payload = bytes(buffered[:newline])
                del buffered[: newline + 1]
                if len(payload) > MAX_DOCUMENT_BYTES:
                    self._offer(_FrameFailure(None, "frame exceeds the Run/1 limit"))
                    return
                try:
                    frame = parse_json1(payload)
                except Json1Error as error:
                    response = -32700 if error.best_effort_parse_error else None
                    self._offer(_FrameFailure(response, str(error)))
                    return
                if not self._offer(frame):
                    return

    def _offer_end_of_file(self, *, incomplete: bool) -> None:
        # A conforming host keeps its sending half open while the root request
        # is pending. Once root publication has claimed the terminal boundary,
        # however, a later EOF (including a trailing partial frame) cannot
        # replace that response with a channel failure.
        with self._write_lock:
            if self._terminal_phase != "open":
                return
        self._offer(_EndOfFile(incomplete=incomplete))

    async def _write(
        self,
        value: Any,
        *,
        preserve_cancellation: bool = True,
        fatal_diagnostic: bool = False,
        publishes_root: bool = False,
    ) -> None:
        payload = encode_json1(value) + b"\n"

        def write() -> bool:
            with self._write_lock:
                if fatal_diagnostic:
                    if self._terminal_phase != "fatal":
                        return False
                elif publishes_root:
                    if self._terminal_phase != "open":
                        return False
                    self._terminal_phase = "publishing_root"
                elif self._terminal_phase != "open":
                    return False
                try:
                    sys.stdout.buffer.write(payload)
                    sys.stdout.buffer.flush()
                except Exception:
                    if publishes_root:
                        self._terminal_phase = "root_write_failed"
                    raise
                if publishes_root:
                    self._terminal_phase = "root_published"
                return True

        worker = asyncio.create_task(asyncio.to_thread(write))
        try:
            written = await asyncio.shield(worker)
        except asyncio.CancelledError:
            # Once a frame write starts it remains atomic. Root responses use
            # this to let a completed response win a cancellation race.
            written = await worker
            if preserve_cancellation:
                raise
        except Exception as error:
            await self._fatal_close("CHANNEL_LOST")
            raise OperationError("CHANNEL_LOST") from error
        if not written:
            raise self._fatal_error or OperationError("OWNER_CLOSED")

    async def _dispatch(self) -> None:
        while not self._done.is_set():
            item = await self._frames.get()
            if isinstance(item, _EndOfFile):
                await self._fatal_close(
                    "PROTOCOL_ERROR" if item.incomplete else "CHANNEL_LOST"
                )
                return
            if isinstance(item, _FrameFailure):
                if item.response_code is not None:
                    await self._best_effort_standard_error(None, item.response_code, "Parse error")
                await self._fatal_close(item.local_code)
                return
            await self._handle_frame(item)

    async def _handle_frame(self, frame: Any) -> None:
        if not isinstance(frame, dict):
            await self._best_effort_standard_error(None, -32600, "Invalid Request")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        if frame.get("jsonrpc") != "2.0":
            request_id = frame.get("id") if _is_wire_id(frame.get("id")) else None
            await self._best_effort_standard_error(request_id, -32600, "Invalid Request")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        if "method" in frame:
            if not isinstance(frame["method"], str):
                await self._best_effort_standard_error(None, -32600, "Invalid Request")
                await self._fatal_close("PROTOCOL_ERROR")
                return
            if "params" in frame and not isinstance(frame["params"], (dict, list)):
                await self._best_effort_standard_error(None, -32600, "Invalid Request")
                await self._fatal_close("PROTOCOL_ERROR")
                return
            if "id" in frame:
                await self._handle_request(frame)
            else:
                await self._handle_notification(frame)
            return
        if "id" in frame and (("result" in frame) ^ ("error" in frame)):
            await self._handle_response(frame)
            return
        request_id = frame.get("id") if _is_wire_id(frame.get("id")) else None
        await self._best_effort_standard_error(request_id, -32600, "Invalid Request")
        await self._fatal_close("PROTOCOL_ERROR")

    async def _handle_request(self, frame: dict[str, Any]) -> None:
        if not set(frame).issubset({"jsonrpc", "id", "method", "params"}):
            await self._best_effort_standard_error(None, -32600, "Invalid Request")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        try:
            request_id = _require_wire_id(frame["id"], "id")
        except _InvalidParams:
            await self._best_effort_standard_error(None, -32600, "Invalid Request")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        if request_id in self._host_ids:
            await self._fatal_close("PROTOCOL_ERROR")
            return
        self._host_ids.add(request_id)

        method = frame["method"]
        if method != "flow/run":
            await self._standard_error(request_id, -32601, "Method not found")
            return
        if self._root_id is not None:
            await self._best_effort_standard_error(request_id, -32600, "Invalid Request")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        try:
            input_value, settings, attachments, scratch, deadline = _validate_flow_run_params(
                frame.get("params")
            )
        except (Json1Error, _InvalidParams):
            await self._standard_error(
                request_id,
                -32602,
                "Invalid params",
                publishes_root=True,
            )
            self._done.set()
            return

        self._root_id = request_id
        self._root_phase = "open"
        self._accepting_calls = True
        context = _RunContextImpl(
            input=input_value,
            settings=settings,
            attachments=attachments,
            scratch=scratch,
            deadline_unix_ms=deadline,
            _client=self,
        )
        self._root_task = asyncio.create_task(self._run_handler(context), name="flowmd-run-handler")

    async def _handle_notification(self, frame: dict[str, Any]) -> None:
        if not set(frame).issubset({"jsonrpc", "method", "params"}):
            await self._fatal_close("PROTOCOL_ERROR")
            return
        method = frame["method"]
        if method != "request/cancel":
            return
        if set(frame) != {"jsonrpc", "method", "params"}:
            await self._fatal_close("PROTOCOL_ERROR")
            return
        try:
            params = _require_exact_object(frame["params"], {"requestId"}, {"requestId"})
            request_id = _require_wire_id(params["requestId"], "requestId")
        except _InvalidParams:
            await self._fatal_close("PROTOCOL_ERROR")
            return
        if (
            request_id == self._root_id
            and self._root_task is not None
            and not self._root_task.done()
            and self._root_phase == "open"
        ):
            if self._termination_code is None:
                self._root_phase = "completing"
                self._accepting_calls = False
                self._termination_code = "CANCELLED"
                self._root_task.cancel()

    async def _handle_response(self, frame: dict[str, Any]) -> None:
        if set(frame) not in (
            {"jsonrpc", "id", "result"},
            {"jsonrpc", "id", "error"},
        ):
            await self._fatal_close("PROTOCOL_ERROR")
            return
        request_id = frame.get("id")
        if not _is_wire_id(request_id):
            await self._fatal_close("PROTOCOL_ERROR")
            return
        pending = self._pending.get(request_id)
        if pending is None:
            await self._fatal_close("PROTOCOL_ERROR")
            return
        try:
            if "error" in frame:
                result: Any = _flow_error_from_wire(frame["error"])
                is_error = True
            elif pending.kind == "flow":
                result = _validate_run_wire_result(frame["result"])
                is_error = False
            else:
                tag, payload = _validate_effect_wire_result(frame["result"])
                if tag == "error":
                    name, data = payload
                    result = EffectError(name, data)
                    is_error = True
                else:
                    result = payload
                    is_error = False
        except (Json1Error, _InvalidParams):
            await self._fatal_close("PROTOCOL_ERROR")
            return
        self._settle_pending(request_id, result, is_error=is_error)

    async def _run_handler(self, context: RunContext) -> None:
        assert self._root_id is not None
        try:
            returned = self._handler(context)
            if not inspect.isawaitable(returned):
                raise TypeError("FLOW Run handler must be async")
            result = await returned
            if self._termination_code is not None:
                raise OperationError(self._termination_code)
            self._root_phase = "completing"
            self._accepting_calls = False
            # A caller may deliberately cancel and await one call while its
            # required wire response remains pending. Only a live waiter (or
            # a call still unwinding) is abandonment.
            abandoned_at_return = self._active_calls > 0 or any(
                not pending.user_cancelled for pending in self._pending.values()
            )
            if self._pending or self._active_calls > 0:
                await self._cancel_pending_waiters("OWNER_CLOSED")
                await self._await_quiescence()
            if abandoned_at_return:
                raise OperationError("EXECUTION_FAILED")
            validated = _validate_run_result(result)
            await self._write(
                {
                    "jsonrpc": "2.0",
                    "id": self._root_id,
                    "result": {
                        "outcome": validated["outcome"],
                        "output": normalize_json1(validated["output"]),
                    },
                },
                preserve_cancellation=False,
                publishes_root=True,
            )
        except asyncio.CancelledError:
            self._root_phase = "completing"
            self._accepting_calls = False
            if self._fatal:
                return
            code = self._termination_code or "CANCELLED"
            await self._cancel_pending_waiters(code)
            await self._await_quiescence()
            await self._operation_error(self._root_id, OperationError(code))
        except OperationError as error:
            self._root_phase = "completing"
            self._accepting_calls = False
            failure = (
                OperationError(self._termination_code)
                if self._termination_code is not None
                else error
            )
            await self._cancel_pending_waiters(failure.code)
            await self._await_quiescence()
            await self._operation_error(self._root_id, failure)
        except (Json1Error, _InvalidParams) as error:
            self._root_phase = "completing"
            self._accepting_calls = False
            failure = (
                OperationError(self._termination_code)
                if self._termination_code is not None
                else OperationError("INVALID_RESULT", message=str(error))
            )
            await self._cancel_pending_waiters(failure.code)
            await self._await_quiescence()
            await self._operation_error(self._root_id, failure)
        except Exception as error:
            self._root_phase = "completing"
            self._accepting_calls = False
            failure = (
                OperationError(self._termination_code)
                if self._termination_code is not None
                else OperationError("EXECUTION_FAILED")
            )
            await self._cancel_pending_waiters(failure.code)
            await self._await_quiescence()
            if self._termination_code is None:
                self._diagnose(error)
            await self._operation_error(self._root_id, failure)
        finally:
            self._root_phase = "terminal"
            self._accepting_calls = False
            # A fatal dispatcher owns channel completion so it can finish its
            # optional diagnostic response before run() tears the dispatcher
            # down. Normal root completion still owns the process lifetime.
            if not self._fatal:
                self._done.set()

    @staticmethod
    def _diagnose(error: Exception) -> None:
        """Write bounded diagnostics without affecting protocol completion."""

        try:
            payload = "".join(traceback.format_exception(error)).encode(
                "utf-8", "backslashreplace"
            )[:65_536]
            descriptor = sys.stderr.fileno()
            was_blocking = os.get_blocking(descriptor)
            try:
                os.set_blocking(descriptor, False)
                os.write(descriptor, payload)
            finally:
                os.set_blocking(descriptor, was_blocking)
        except Exception:
            pass

    async def call_flow(
        self,
        *,
        operation_id: str,
        slot: str,
        input: Any,
        intent: str | None,
    ) -> RunResult:
        _require_wire_id(operation_id, "operation_id")
        _require_local_name(slot, "slot")
        params: dict[str, Any] = {
            "operationId": operation_id,
            "slot": slot,
            "input": normalize_json1(input),
        }
        if intent is not None:
            if not isinstance(intent, str) or not (1 <= len(intent) <= 16_384):
                raise ValueError("intent must contain 1 to 16,384 Unicode scalars")
            params["intent"] = intent
        normalized = normalize_json1(params)
        assert isinstance(normalized, dict)
        encode_json1(normalized)
        result = await self._send_request("flow", "flow/call", normalized)
        assert isinstance(result, dict)
        return result

    async def call_effect(
        self,
        *,
        operation_id: str,
        slot: str,
        method: str,
        input: Any,
    ) -> Any:
        _require_wire_id(operation_id, "operation_id")
        _require_local_name(slot, "slot")
        _require_local_name(method, "method")
        params = {
            "operationId": operation_id,
            "slot": slot,
            "method": method,
            "input": normalize_json1(input),
        }
        normalized = normalize_json1(params)
        assert isinstance(normalized, dict)
        encode_json1(normalized)
        return await self._send_request("effect", "effect/call", normalized)

    async def _send_request(self, kind: str, method: str, params: dict[str, Any]) -> Any:
        if not self._accepting_calls or self._root_id is None:
            raise OperationError("OWNER_CLOSED")
        self._active_calls += 1
        self._calls_empty.clear()
        try:
            await self._outstanding.acquire()
            if not self._accepting_calls:
                self._outstanding.release()
                raise OperationError("OWNER_CLOSED")
            request_id = f"component:{self._next_request_id}"
            self._next_request_id += 1
            if request_id in self._component_ids:
                self._outstanding.release()
                raise RuntimeError("component request ID exhausted")
            self._component_ids.add(request_id)
            future = asyncio.get_running_loop().create_future()
            future.add_done_callback(
                lambda settled: None
                if settled.cancelled()
                else settled.exception()
            )
            self._pending[request_id] = _Pending(kind=kind, future=future)
            self._pending_empty.clear()
            try:
                await self._write(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": method,
                        "params": params,
                    }
                )
            except asyncio.CancelledError:
                self._mark_user_cancelled(request_id)
                await self._send_cancel(request_id)
                raise
            except Exception:
                if request_id in self._pending:
                    self._settle_pending(
                        request_id,
                        OperationError("CHANNEL_LOST"),
                        is_error=True,
                    )
                raise
            try:
                return await future
            except asyncio.CancelledError:
                self._mark_user_cancelled(request_id)
                await self._send_cancel(request_id)
                raise
        finally:
            self._active_calls -= 1
            if self._active_calls == 0:
                self._calls_empty.set()

    def _mark_user_cancelled(self, request_id: str) -> None:
        pending = self._pending.get(request_id)
        if pending is not None:
            pending.user_cancelled = True

    async def _send_cancel(self, request_id: str) -> None:
        pending = self._pending.get(request_id)
        if pending is None or pending.cancel_sent or self._fatal:
            return
        pending.cancel_sent = True
        try:
            await self._write(
                {
                    "jsonrpc": "2.0",
                    "method": "request/cancel",
                    "params": {"requestId": request_id},
                },
                preserve_cancellation=False,
            )
        except OperationError:
            pass

    def _settle_pending(self, request_id: str, value: Any, *, is_error: bool) -> None:
        pending = self._pending.pop(request_id)
        if not pending.future.done():
            if is_error:
                pending.future.set_exception(value)
            else:
                pending.future.set_result(value)
        self._outstanding.release()
        if not self._pending:
            self._pending_empty.set()

    async def _cancel_pending_waiters(self, code: OperationErrorCode) -> None:
        """Cancel owned work without forgetting its required wire response."""

        request_ids = list(self._pending)
        for request_id in request_ids:
            await self._send_cancel(request_id)
        for request_id in request_ids:
            pending = self._pending.get(request_id)
            if pending is not None and not pending.future.done():
                pending.future.set_exception(OperationError(code))

    def _drop_pending(self, code: OperationErrorCode) -> None:
        """Forget sent requests only after the channel itself is terminal."""

        for request_id in list(self._pending):
            self._settle_pending(request_id, OperationError(code), is_error=True)

    async def _await_quiescence(self) -> None:
        await self._pending_empty.wait()
        await self._calls_empty.wait()

    async def _operation_error(self, request_id: str, error: OperationError) -> None:
        if self._fatal:
            return
        response = self._execution_failure_response(request_id)
        try:
            code = error.code
            message = error.message
            valid = (
                isinstance(code, str)
                and code in _FLOW_ERROR_CODES
                and isinstance(message, str)
                and 1 <= len(message) <= 1_024
            )
            if valid:
                normalize_json1(message)
                data: dict[str, Any] = {"code": code}
                if error.details is not None:
                    data["details"] = normalize_json1(error.details)
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": -32000,
                        "message": message,
                        "data": data,
                    },
                }
                encode_json1(response)
        except Exception:
            response = self._execution_failure_response(request_id)
        await self._write(
            response,
            preserve_cancellation=False,
            publishes_root=True,
        )

    @staticmethod
    def _execution_failure_response(request_id: str) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32000,
                "message": "EXECUTION_FAILED",
                "data": {"code": "EXECUTION_FAILED"},
            },
        }

    async def _standard_error(
        self,
        request_id: str | None,
        code: int,
        message: str,
        *,
        publishes_root: bool = False,
        fatal_diagnostic: bool = False,
    ) -> None:
        await self._write(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": code, "message": message},
            },
            preserve_cancellation=False,
            fatal_diagnostic=fatal_diagnostic,
            publishes_root=publishes_root,
        )

    async def _best_effort_standard_error(
        self,
        request_id: str | None,
        code: int,
        message: str,
    ) -> None:
        # Every caller uses this only for a fatal envelope/framing violation.
        # Close admission before serializing the diagnostic so an already
        # queued root call cannot appear after that final frame.
        if not self._begin_fatal("PROTOCOL_ERROR"):
            return
        try:
            await self._standard_error(
                request_id,
                code,
                message,
                fatal_diagnostic=True,
            )
        except Exception:
            pass

    def _begin_fatal(self, code: OperationErrorCode) -> bool:
        with self._write_lock:
            if self._terminal_phase in {"publishing_root", "root_published"}:
                return False
            if self._terminal_phase != "fatal":
                self._terminal_phase = "fatal"
        if self._fatal:
            return True
        self._fatal = True
        self._fatal_error = OperationError(code)
        self._accepting_calls = False
        self._drop_pending(code)
        current = asyncio.current_task()
        if self._root_task is not None and self._root_task is not current:
            self._root_task.cancel()
        return True

    async def _fatal_close(self, code: OperationErrorCode) -> None:
        if self._begin_fatal(code):
            self._done.set()


def serve(handler: RunHandler) -> None:
    """Serve exactly one FLOW Run/1 request over this process's stdio."""

    if not callable(handler):
        raise TypeError("handler must be callable")
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:
        raise RuntimeError("serve() cannot run inside an existing asyncio event loop")
    asyncio.run(_Runtime(handler).run())
