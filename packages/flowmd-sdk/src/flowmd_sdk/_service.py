from __future__ import annotations

import asyncio
import inspect
import os
import sys
import threading
import traceback
from dataclasses import dataclass, field
from typing import Any

from ._json import MAX_DOCUMENT_BYTES, MAX_SAFE_INTEGER, Json1Error, encode_json1, normalize_json1, parse_json1
from ._runtime import (
    _FLOW_ERROR_CODES,
    _OUTSTANDING_LIMIT,
    _QUEUE_LIMIT,
    _REQUEST_ID_LIMIT,
    _EndOfFile,
    _FrameFailure,
    _InvalidParams,
    _flow_error_from_wire,
    _is_wire_id,
    _require_exact_object,
    _require_local_name,
    _require_wire_id,
    _validate_effect_wire_result,
    _validate_run_wire_result,
)
from ._types import (
    Attachment,
    EffectError,
    JsonValue,
    OperationError,
    OperationErrorCode,
    RunResult,
    ServiceDefinition,
    ServiceError,
    ServiceExportHandler,
    ServiceInvocationContext,
    ServiceMountContext,
)


@dataclass(slots=True)
class _Owner:
    request_id: str
    kind: str
    accepting: bool = True
    task: asyncio.Task[None] | None = None
    pending: set[str] = field(default_factory=set)
    active_calls: int = 0
    termination_code: OperationErrorCode | None = None
    terminal_claimed: bool = False
    empty: asyncio.Event = field(default_factory=asyncio.Event)

    def __post_init__(self) -> None:
        self.empty.set()


@dataclass(slots=True)
class _Pending:
    kind: str
    owner: _Owner
    future: asyncio.Future[Any]
    request_written: asyncio.Event = field(default_factory=asyncio.Event)
    cancel_sent: bool = False
    user_cancelled: bool = False


@dataclass(frozen=True, slots=True)
class _MountContextImpl:
    settings: dict[str, JsonValue]
    attachments: dict[str, Attachment]
    scratch: str
    startup_deadline_unix_ms: int
    _runtime: _ServiceRuntime
    _owner: _Owner
    _cancelled: asyncio.Event

    async def ready(self) -> None:
        await self._runtime.ready(self._owner)

    async def cancelled(self) -> None:
        await self._cancelled.wait()

    async def call_flow(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
    ) -> RunResult:
        return await self._runtime.call_flow(
            self._owner,
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
        return await self._runtime.call_effect(
            self._owner,
            operation_id=operation_id,
            slot=slot,
            method=method,
            input=input,
        )


@dataclass(frozen=True, slots=True)
class _InvocationContextImpl:
    export_name: str
    method: str
    input: JsonValue
    deadline_unix_ms: int
    _runtime: _ServiceRuntime
    _owner: _Owner

    async def call_flow(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
    ) -> RunResult:
        return await self._runtime.call_flow(
            self._owner,
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
        return await self._runtime.call_effect(
            self._owner,
            operation_id=operation_id,
            slot=slot,
            method=method,
            input=input,
        )


class _ServiceRuntime:
    def __init__(self, definition: ServiceDefinition):
        if not isinstance(definition, ServiceDefinition):
            raise TypeError("definition must be a ServiceDefinition")
        if not callable(definition.mount):
            raise TypeError("Service definition requires a mount handler")
        if not isinstance(definition.exports, dict):
            try:
                exports = dict(definition.exports)
            except Exception as error:
                raise TypeError("Service exports must be a mapping") from error
        else:
            exports = dict(definition.exports)
        if len(exports) > 256:
            raise TypeError("Service permits at most 256 exports")
        for name, handler in exports.items():
            _require_local_name(name, "Service export")
            if not callable(handler):
                raise TypeError(f"Service export {name} must be callable")
        self._exports: dict[str, ServiceExportHandler] = dict(sorted(exports.items()))
        self._export_names = tuple(self._exports)
        self._mount_handler = definition.mount
        self._loop: asyncio.AbstractEventLoop | None = None
        self._frames: asyncio.Queue[Any] = asyncio.Queue(maxsize=_QUEUE_LIMIT)
        self._reader_stop = threading.Event()
        self._write_lock = threading.Lock()
        self._terminal_phase = "open"
        self._done = asyncio.Event()
        self._fatal = False
        self._fatal_error: OperationError | None = None
        self._host_ids: set[str] = set()
        self._provider_ids: set[str] = set()
        self._next_request_id = 1
        self._pending: dict[str, _Pending] = {}
        self._outstanding = asyncio.Semaphore(_OUTSTANDING_LIMIT)
        self._owners: dict[str, _Owner] = {}
        self._mount: _Owner | None = None
        self._mount_cancelled = asyncio.Event()
        self._readiness = "not-called"
        self._admitting_invocations = False

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        reader = threading.Thread(target=self._reader, name="flowmd-service-reader", daemon=True)
        reader.start()
        dispatch = asyncio.create_task(self._dispatch(), name="flowmd-service-dispatch")
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
                self._offer(_FrameFailure(None, "frame exceeds the Service/1 limit"))
                return
            while True:
                newline = buffered.find(b"\n")
                if newline < 0:
                    break
                payload = bytes(buffered[:newline])
                del buffered[: newline + 1]
                if len(payload) > MAX_DOCUMENT_BYTES:
                    self._offer(_FrameFailure(None, "frame exceeds the Service/1 limit"))
                    return
                try:
                    frame = parse_json1(payload)
                except Json1Error as error:
                    self._offer(_FrameFailure(-32700 if error.best_effort_parse_error else None, str(error)))
                    return
                if not self._offer(frame):
                    return

    def _offer_end_of_file(self, *, incomplete: bool) -> None:
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
        publishes_mount: bool = False,
    ) -> None:
        payload = encode_json1(value) + b"\n"

        def write() -> bool:
            with self._write_lock:
                if fatal_diagnostic:
                    if self._terminal_phase != "fatal":
                        return False
                elif publishes_mount:
                    if self._terminal_phase != "open":
                        return False
                    self._terminal_phase = "publishing_mount"
                elif self._terminal_phase != "open":
                    return False
                try:
                    sys.stdout.buffer.write(payload)
                    sys.stdout.buffer.flush()
                except Exception:
                    if publishes_mount:
                        self._terminal_phase = "mount_write_failed"
                    raise
                if publishes_mount:
                    self._terminal_phase = "mount_published"
                return True

        worker = asyncio.create_task(asyncio.to_thread(write))
        try:
            written = await asyncio.shield(worker)
        except asyncio.CancelledError:
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
                await self._fatal_close("PROTOCOL_ERROR" if item.incomplete else "CHANNEL_LOST")
                return
            if isinstance(item, _FrameFailure):
                if item.response_code is not None:
                    await self._best_effort_standard_error(None, item.response_code, "Parse error")
                await self._fatal_close(item.local_code)
                return
            await self._handle_frame(item)

    async def _handle_frame(self, frame: Any) -> None:
        if not isinstance(frame, dict) or frame.get("jsonrpc") != "2.0":
            await self._best_effort_standard_error(None, -32600, "Invalid Request")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        if "method" in frame:
            if not isinstance(frame["method"], str) or (
                "params" in frame and not isinstance(frame["params"], (dict, list))
            ):
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
        await self._best_effort_standard_error(None, -32600, "Invalid Request")
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
        if request_id in self._host_ids or len(self._host_ids) >= _REQUEST_ID_LIMIT:
            await self._fatal_close("PROTOCOL_ERROR")
            return
        self._host_ids.add(request_id)
        method = frame["method"]
        if method == "service/mount":
            await self._handle_mount(request_id, frame.get("params"))
        elif method == "service/invoke":
            await self._handle_invoke(request_id, frame.get("params"))
        else:
            await self._standard_error(request_id, -32601, "Method not found")

    async def _handle_mount(self, request_id: str, value: Any) -> None:
        if self._mount is not None:
            await self._best_effort_standard_error(request_id, -32600, "Invalid Request")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        try:
            settings, attachments, scratch, deadline = _validate_mount_params(value)
        except (Json1Error, _InvalidParams):
            await self._standard_error(request_id, -32602, "Invalid params", publishes_mount=True)
            self._done.set()
            return
        owner = _Owner(request_id=request_id, kind="mount")
        self._owners[request_id] = owner
        self._mount = owner
        context = _MountContextImpl(
            settings=settings,
            attachments=attachments,
            scratch=scratch,
            startup_deadline_unix_ms=deadline,
            _runtime=self,
            _owner=owner,
            _cancelled=self._mount_cancelled,
        )
        owner.task = asyncio.create_task(self._run_mount(owner, context), name="flowmd-service-mount")

    async def _handle_invoke(self, request_id: str, value: Any) -> None:
        if not self._admitting_invocations or self._mount is None:
            await self._best_effort_standard_error(request_id, -32600, "Service is not ready")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        if len(self._owners) >= _OUTSTANDING_LIMIT:
            await self._operation_error(request_id, OperationError("RESOURCE_EXHAUSTED"))
            return
        try:
            export_name, method, input_value, deadline = _validate_invoke_params(value)
        except (Json1Error, _InvalidParams):
            await self._standard_error(request_id, -32602, "Invalid params")
            return
        handler = self._exports.get(export_name)
        if handler is None:
            await self._best_effort_standard_error(request_id, -32602, "Undeclared Service export")
            await self._fatal_close("PROTOCOL_ERROR")
            return
        owner = _Owner(request_id=request_id, kind="invocation")
        self._owners[request_id] = owner
        context = _InvocationContextImpl(
            export_name=export_name,
            method=method,
            input=input_value,
            deadline_unix_ms=deadline,
            _runtime=self,
            _owner=owner,
        )
        owner.task = asyncio.create_task(self._run_invocation(owner, handler, context), name=f"flowmd-service-{request_id}")

    async def _handle_notification(self, frame: dict[str, Any]) -> None:
        if not set(frame).issubset({"jsonrpc", "method", "params"}):
            await self._fatal_close("PROTOCOL_ERROR")
            return
        if frame["method"] != "request/cancel":
            return
        try:
            params = _require_exact_object(frame.get("params"), {"requestId"}, {"requestId"})
            request_id = _require_wire_id(params["requestId"], "requestId")
        except _InvalidParams:
            await self._fatal_close("PROTOCOL_ERROR")
            return
        owner = self._owners.get(request_id)
        if owner is None or owner.terminal_claimed:
            return
        owner.accepting = False
        owner.termination_code = "CANCELLED"
        if owner.kind == "mount":
            self._admitting_invocations = False
            self._mount_cancelled.set()
            for child in list(self._owners.values()):
                if child.kind == "invocation":
                    await self._cancel_owner(child, "OWNER_CLOSED")
            await self._cancel_owner_pending(owner, "CANCELLED")
        else:
            await self._cancel_owner(owner, "CANCELLED")

    async def _handle_response(self, frame: dict[str, Any]) -> None:
        if set(frame) not in ({"jsonrpc", "id", "result"}, {"jsonrpc", "id", "error"}):
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
            elif pending.kind == "ready":
                if not isinstance(frame["result"], dict) or frame["result"]:
                    raise _InvalidParams("invalid service/ready acknowledgement")
                self._readiness = "acknowledged"
                self._admitting_invocations = pending.owner.accepting
                result = None
                is_error = False
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

    async def _run_mount(self, owner: _Owner, context: ServiceMountContext) -> None:
        failure: OperationError | None = None
        try:
            returned = self._mount_handler(context)
            if not inspect.isawaitable(returned):
                raise TypeError("Service mount handler must be async")
            await returned
            if self._readiness != "acknowledged" and owner.termination_code is None:
                failure = OperationError("INVALID_RESULT")
        except asyncio.CancelledError:
            if self._fatal:
                return
            failure = OperationError(owner.termination_code or "CANCELLED")
        except OperationError as error:
            failure = error
        except (Json1Error, _InvalidParams) as error:
            failure = OperationError("INVALID_RESULT", str(error))
        except Exception as error:
            self._diagnose(error)
            failure = OperationError("EXECUTION_FAILED")

        owner.accepting = False
        self._admitting_invocations = False
        abandoned = owner.active_calls > 0 or bool(owner.pending)
        for child in list(self._owners.values()):
            if child.kind == "invocation":
                await self._cancel_owner(child, "OWNER_CLOSED")
        await self._cancel_owner_pending(owner, "OWNER_CLOSED")
        await asyncio.gather(
            *(child.task for child in self._owners.values() if child.kind == "invocation" and child.task is not None),
            return_exceptions=True,
        )
        await owner.empty.wait()
        if owner.termination_code is None and abandoned and failure is None:
            failure = OperationError("EXECUTION_FAILED")
        try:
            owner.terminal_claimed = True
            if owner.termination_code == "CANCELLED" or failure is None:
                await self._write(
                    {"jsonrpc": "2.0", "id": owner.request_id, "result": {}},
                    preserve_cancellation=False,
                    publishes_mount=True,
                )
            else:
                await self._operation_error(owner.request_id, failure, publishes_mount=True)
        finally:
            self._owners.pop(owner.request_id, None)
            if not self._fatal:
                self._done.set()

    async def _run_invocation(
        self,
        owner: _Owner,
        handler: ServiceExportHandler,
        context: ServiceInvocationContext,
    ) -> None:
        result: JsonValue = None
        service_error: ServiceError | None = None
        failure: OperationError | None = None
        try:
            returned = handler(context)
            if not inspect.isawaitable(returned):
                raise TypeError("Service export handler must be async")
            result = await returned
        except asyncio.CancelledError:
            if self._fatal:
                return
            failure = OperationError(owner.termination_code or "CANCELLED")
        except ServiceError as error:
            service_error = error
        except OperationError as error:
            failure = error
        except (Json1Error, _InvalidParams) as error:
            failure = OperationError("INVALID_RESULT", str(error))
        except Exception as error:
            self._diagnose(error)
            failure = OperationError("EXECUTION_FAILED")

        owner.accepting = False
        abandoned = owner.active_calls > 0 or bool(owner.pending)
        await self._cancel_owner_pending(owner, "OWNER_CLOSED")
        await owner.empty.wait()
        if owner.termination_code is not None:
            failure = OperationError(owner.termination_code)
            service_error = None
        elif abandoned and failure is None:
            failure = OperationError("EXECUTION_FAILED")
        try:
            owner.terminal_claimed = True
            if failure is not None:
                await self._operation_error(owner.request_id, failure)
            elif service_error is not None:
                name = _require_local_name(service_error.error_name, "Service error name")
                data = normalize_json1(service_error.data)
                await self._write({
                    "jsonrpc": "2.0",
                    "id": owner.request_id,
                    "result": {"error": {"name": name, "data": data}},
                }, preserve_cancellation=False)
            else:
                await self._write({
                    "jsonrpc": "2.0",
                    "id": owner.request_id,
                    "result": {"value": normalize_json1(result)},
                }, preserve_cancellation=False)
        except (Json1Error, _InvalidParams):
            await self._operation_error(owner.request_id, OperationError("INVALID_RESULT"))
        finally:
            self._owners.pop(owner.request_id, None)

    async def ready(self, owner: _Owner) -> None:
        if owner is not self._mount or not owner.accepting or self._readiness != "not-called":
            raise OperationError("OWNER_CLOSED")
        self._readiness = "pending"
        try:
            await self._send_request(
                owner,
                "ready",
                "service/ready",
                {"ownerRequestId": owner.request_id, "exports": list(self._export_names)},
            )
        except Exception:
            self._readiness = "failed"
            raise
        self._readiness = "acknowledged"
        self._admitting_invocations = owner.accepting

    async def call_flow(
        self,
        owner: _Owner,
        *,
        operation_id: str,
        slot: str,
        input: Any,
        intent: str | None,
    ) -> RunResult:
        _require_wire_id(operation_id, "operation_id")
        _require_local_name(slot, "slot")
        params: dict[str, Any] = {
            "ownerRequestId": owner.request_id,
            "operationId": operation_id,
            "slot": slot,
            "input": normalize_json1(input),
        }
        if intent is not None:
            if not isinstance(intent, str) or not 1 <= len(intent) <= 16_384:
                raise ValueError("intent must contain 1 to 16,384 Unicode scalars")
            params["intent"] = intent
        result = await self._send_request(owner, "flow", "flow/call", params)
        assert isinstance(result, dict)
        return result

    async def call_effect(
        self,
        owner: _Owner,
        *,
        operation_id: str,
        slot: str,
        method: str,
        input: Any,
    ) -> Any:
        _require_wire_id(operation_id, "operation_id")
        _require_local_name(slot, "slot")
        _require_local_name(method, "method")
        return await self._send_request(owner, "effect", "effect/call", {
            "ownerRequestId": owner.request_id,
            "operationId": operation_id,
            "slot": slot,
            "method": method,
            "input": normalize_json1(input),
        })

    async def _send_request(self, owner: _Owner, kind: str, method: str, params: dict[str, Any]) -> Any:
        if not owner.accepting:
            raise OperationError("OWNER_CLOSED")
        owner.active_calls += 1
        owner.empty.clear()
        try:
            await self._outstanding.acquire()
            if not owner.accepting:
                self._outstanding.release()
                raise OperationError("OWNER_CLOSED")
            if len(self._provider_ids) >= _REQUEST_ID_LIMIT:
                self._outstanding.release()
                raise OperationError("RESOURCE_EXHAUSTED")
            request_id = f"provider:{self._next_request_id}"
            self._next_request_id += 1
            self._provider_ids.add(request_id)
            future = asyncio.get_running_loop().create_future()
            future.add_done_callback(lambda settled: None if settled.cancelled() else settled.exception())
            pending = _Pending(kind=kind, owner=owner, future=future)
            self._pending[request_id] = pending
            owner.pending.add(request_id)
            try:
                try:
                    await self._write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": normalize_json1(params)})
                finally:
                    pending.request_written.set()
            except asyncio.CancelledError:
                pending.user_cancelled = True
                await self._send_cancel(request_id)
                raise
            try:
                return await future
            except asyncio.CancelledError:
                pending.user_cancelled = True
                await self._send_cancel(request_id)
                raise
        finally:
            owner.active_calls -= 1
            self._update_owner_empty(owner)

    async def _send_cancel(self, request_id: str) -> None:
        pending = self._pending.get(request_id)
        if pending is None or pending.cancel_sent or self._fatal:
            return
        # The cancellation names a request already visible to the Host. A
        # thread-backed stdout write and an owner cancellation may otherwise
        # race, putting this notification on the wire first.
        await pending.request_written.wait()
        pending = self._pending.get(request_id)
        if pending is None or pending.cancel_sent or self._fatal:
            return
        pending.cancel_sent = True
        try:
            await self._write({"jsonrpc": "2.0", "method": "request/cancel", "params": {"requestId": request_id}}, preserve_cancellation=False)
        except OperationError:
            pass

    async def _cancel_owner(self, owner: _Owner, code: OperationErrorCode) -> None:
        if owner.termination_code is None:
            owner.termination_code = code
        owner.accepting = False
        await self._cancel_owner_pending(owner, code)
        current = asyncio.current_task()
        if owner.task is not None and owner.task is not current:
            owner.task.cancel()

    async def _cancel_owner_pending(self, owner: _Owner, code: OperationErrorCode) -> None:
        for request_id in list(owner.pending):
            await self._send_cancel(request_id)
            pending = self._pending.get(request_id)
            if pending is not None and not pending.future.done():
                pending.future.set_exception(OperationError(code))

    def _settle_pending(self, request_id: str, value: Any, *, is_error: bool) -> None:
        pending = self._pending.pop(request_id)
        pending.owner.pending.discard(request_id)
        if not pending.future.done():
            if is_error:
                pending.future.set_exception(value)
            else:
                pending.future.set_result(value)
        self._outstanding.release()
        self._update_owner_empty(pending.owner)

    def _drop_pending(self, code: OperationErrorCode) -> None:
        for request_id in list(self._pending):
            self._settle_pending(request_id, OperationError(code), is_error=True)

    @staticmethod
    def _update_owner_empty(owner: _Owner) -> None:
        if owner.active_calls == 0 and not owner.pending:
            owner.empty.set()
        else:
            owner.empty.clear()

    async def _operation_error(
        self,
        request_id: str,
        error: OperationError,
        *,
        publishes_mount: bool = False,
    ) -> None:
        response: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32000,
                "message": "EXECUTION_FAILED",
                "data": {"code": "EXECUTION_FAILED"},
            },
        }
        try:
            code: OperationErrorCode = (
                error.code
                if isinstance(error.code, str) and error.code in _FLOW_ERROR_CODES
                else "EXECUTION_FAILED"
            )
            message = (
                error.message
                if isinstance(error.message, str) and 1 <= len(error.message) <= 1_024
                else code
            )
            data: dict[str, Any] = {"code": code}
            if error.details is not None:
                data["details"] = normalize_json1(error.details)
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32000, "message": message, "data": data},
            }
            encode_json1(response)
        except Exception:
            pass
        await self._write(response, preserve_cancellation=False, publishes_mount=publishes_mount)

    async def _standard_error(
        self,
        request_id: str | None,
        code: int,
        message: str,
        *,
        publishes_mount: bool = False,
        fatal_diagnostic: bool = False,
    ) -> None:
        await self._write(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}},
            preserve_cancellation=False,
            publishes_mount=publishes_mount,
            fatal_diagnostic=fatal_diagnostic,
        )

    async def _best_effort_standard_error(self, request_id: str | None, code: int, message: str) -> None:
        if not self._begin_fatal("PROTOCOL_ERROR"):
            return
        try:
            await self._standard_error(request_id, code, message, fatal_diagnostic=True)
        except Exception:
            pass

    def _begin_fatal(self, code: OperationErrorCode) -> bool:
        with self._write_lock:
            if self._terminal_phase in {"publishing_mount", "mount_published"}:
                return False
            if self._terminal_phase != "fatal":
                self._terminal_phase = "fatal"
        if self._fatal:
            return True
        self._fatal = True
        self._fatal_error = OperationError(code)
        self._admitting_invocations = False
        self._drop_pending(code)
        for owner in self._owners.values():
            owner.accepting = False
            if owner.task is not None and owner.task is not asyncio.current_task():
                owner.task.cancel()
        return True

    async def _fatal_close(self, code: OperationErrorCode) -> None:
        if self._begin_fatal(code):
            self._done.set()

    @staticmethod
    def _diagnose(error: Exception) -> None:
        try:
            payload = "".join(traceback.format_exception(error)).encode("utf-8", "backslashreplace")[:65_536]
            os.write(sys.stderr.fileno(), payload)
        except Exception:
            pass


def _validate_mount_params(value: Any) -> tuple[dict[str, JsonValue], dict[str, Attachment], str, int]:
    params = _require_exact_object(
        value,
        {"protocol", "settings", "attachments", "scratch", "startupDeadlineUnixMs"},
        {"protocol", "settings", "attachments", "scratch", "startupDeadlineUnixMs"},
    )
    if params["protocol"] != "service/1" or not isinstance(params["settings"], dict):
        raise _InvalidParams("invalid Service Mount")
    attachments_value = params["attachments"]
    if not isinstance(attachments_value, dict) or len(attachments_value) > 256:
        raise _InvalidParams("invalid attachments")
    attachments: dict[str, Attachment] = {}
    for name, candidate in attachments_value.items():
        _require_local_name(name, "attachment name")
        attachment = _require_exact_object(candidate, {"path", "access"}, {"path", "access"})
        if not isinstance(attachment["path"], str) or not attachment["path"] or attachment["access"] not in {"read", "read-write"}:
            raise _InvalidParams("invalid attachment")
        attachments[name] = {"path": attachment["path"], "access": attachment["access"]}
    scratch = params["scratch"]
    deadline = params["startupDeadlineUnixMs"]
    if not isinstance(scratch, str) or not scratch or isinstance(deadline, bool) or not isinstance(deadline, int) or not 0 <= deadline <= MAX_SAFE_INTEGER:
        raise _InvalidParams("invalid Mount context")
    settings = normalize_json1(params["settings"])
    assert isinstance(settings, dict)
    return settings, attachments, scratch, deadline


def _validate_invoke_params(value: Any) -> tuple[str, str, JsonValue, int]:
    params = _require_exact_object(
        value,
        {"export", "method", "input", "deadlineUnixMs"},
        {"export", "method", "input", "deadlineUnixMs"},
    )
    export_name = _require_local_name(params["export"], "export")
    method = _require_local_name(params["method"], "method")
    deadline = params["deadlineUnixMs"]
    if isinstance(deadline, bool) or not isinstance(deadline, int) or not 0 <= deadline <= MAX_SAFE_INTEGER:
        raise _InvalidParams("invalid invocation deadline")
    return export_name, method, normalize_json1(params["input"]), deadline


def serve_service(definition: ServiceDefinition) -> None:
    """Serve exactly one FLOW Service/1 Mount over this process's stdio."""

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:
        raise RuntimeError("serve_service() cannot run inside an existing asyncio event loop")
    asyncio.run(_ServiceRuntime(definition).run())
