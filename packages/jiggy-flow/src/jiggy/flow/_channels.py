"""Private channel endpoints; authority remains with the Run/1 host."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, cast

from ._json import MAX_SAFE_INTEGER, normalize_json1
from ._types import ChannelContractIdentity, JsonValue, OperationError

if TYPE_CHECKING:
    from ._runtime import _Runtime


def _object(value: Any, fields: set[str], required: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or not required <= value.keys() <= fields:
        raise ValueError("Invalid channel response members")
    return value


def _sequence(value: Any, minimum: int = 0) -> int:
    if type(value) is not int or not minimum <= value <= MAX_SAFE_INTEGER:
        raise ValueError("Invalid channel sequence")
    return value


def validate_grant(value: Any) -> dict[str, Any]:
    grant = _object(value, {"endpoint", "direction", "delivery", "contract", "startSequence"},
                    {"endpoint", "direction", "delivery"})
    validate_reference(grant["endpoint"])
    if (grant["direction"] not in ("send", "receive")
        or grant["delivery"] not in ("direct", "broadcast")):
        raise ValueError("Unsupported channel grant")
    if grant["direction"] == "receive":
        start = _sequence(grant.get("startSequence"), 1)
        if grant["delivery"] == "direct" and start != 1:
            raise ValueError("Direct channel must start at sequence one")
    elif "startSequence" in grant:
        raise ValueError("Sender grant contains receive sequence")
    if "contract" in grant:
        contract = _object(grant["contract"], {"id", "version", "digest"},
                           {"id", "version", "digest"})
        if not isinstance(contract["id"], str) or not _contract_id(contract["id"]):
            raise ValueError("Invalid channel contract ID")
        if not isinstance(contract["version"], str) or re.fullmatch(
            r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", contract["version"]
        ) is None:
            raise ValueError("Invalid channel contract version")
        if not isinstance(contract["digest"], str) or re.fullmatch(
            r"sha256:[0-9a-f]{64}", contract["digest"]
        ) is None:
            raise ValueError("Invalid channel contract digest")
    return grant


def validate_reference(value: Any) -> str:
    if (not isinstance(value, str) or not 1 <= len(value) <= 128
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]*", value) is None):
        raise ValueError("Invalid channel reference")
    return value


def _contract_id(value: str) -> bool:
    match = re.fullmatch(r"https://([^/]+)/(.+)", value)
    if match is None:
        return False
    labels = match[1].split(".")
    return (len(labels) >= 2
            and all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels)
            and not (len(labels) == 4
                     and all(re.fullmatch(r"[0-9]{1,3}", label) and int(label) <= 255
                             for label in labels))
            and all(re.fullmatch(r"[a-z0-9._~-]+", part) and part not in (".", "..")
                    for part in match[2].split("/")))


def validate_channel_result(kind: str, value: Any) -> Any:
    if kind in ("channel/send", "channel/close"):
        if value is not None:
            raise ValueError("Channel send/close must return null")
    elif kind == "channel/create":
        created = _object(value, {"send", "receive", "source"}, {"send"})
        send = validate_grant(created["send"])
        if send["direction"] != "send":
            raise ValueError("Channel creation needs a writer")
        if send["delivery"] == "broadcast":
            _object(created, {"send", "source"}, {"send", "source"})
            validate_reference(created["source"])
        else:
            _object(created, {"send", "receive"}, {"send", "receive"})
            receive = validate_grant(created["receive"])
            if (receive["direction"] != "receive" or receive["delivery"] != "direct"
                or send["endpoint"] == receive["endpoint"]
                or send.get("contract") != receive.get("contract")):
                raise ValueError("Invalid direct-channel pair")
    elif kind == "channel/subscribe":
        receive = validate_grant(value)
        if receive["direction"] != "receive" or receive["delivery"] != "broadcast":
            raise ValueError("Subscription needs a broadcast receiver")
    elif kind == "channel/next":
        record = _object(value, {"item", "end"}, set())
        if len(record) != 1:
            raise ValueError("Channel read needs exactly item or end")
        if "item" in record:
            item = _object(record["item"], {"sequence", "value"}, {"sequence", "value"})
            _sequence(item["sequence"], 1)
            normalize_json1(item["value"])
        else:
            end = _object(record["end"], {"lastSequence"}, {"lastSequence"})
            _sequence(end["lastSequence"])
    elif kind == "channel/release":
        if not isinstance(value, dict):
            raise ValueError("Invalid channel release result")
        status = value.get("status")
        if status == "released":
            _object(value, {"status"}, {"status"})
        elif status == "ended":
            _object(value, {"status", "lastSequence"}, {"status", "lastSequence"})
            _sequence(value["lastSequence"])
        elif status == "failed":
            _object(value, {"status", "code", "details"}, {"status", "code"})
            # Use the same operational code vocabulary as ordinary call errors.
            from ._runtime import _FLOW_ERROR_CODES
            if not isinstance(value["code"], str) or value["code"] not in _FLOW_ERROR_CODES:
                raise ValueError("Invalid channel release failure")
        else:
            raise ValueError("Invalid channel release status")
    else:
        raise ValueError("Unknown channel result kind")
    return value


class _Endpoint:
    def __init__(self, runtime: _Runtime, grant: dict[str, Any]):
        self._runtime = runtime
        self._reference: str = grant["endpoint"]
        self._contract: ChannelContractIdentity | None = grant.get("contract")
        self._delivery: Literal["direct", "broadcast"] = grant["delivery"]
        self._used = False
        # An offer is not proof of transfer. The host retains authoritative
        # rights through rejected admission, joins and failed callees.
        self._offered = False

    @property
    def delivery(self) -> Literal["direct", "broadcast"]:
        return self._delivery

    @property
    def contract(self) -> ChannelContractIdentity | None:
        return None if self._contract is None else dict(self._contract)  # type: ignore[return-value]


class _Sender(_Endpoint):
    def __init__(self, runtime: _Runtime, grant: dict[str, Any]):
        super().__init__(runtime, grant)
        self._sealed = False
        self._sends = 0
        self._close_task: asyncio.Task[Any] | None = None

    @property
    def direction(self) -> Literal["send"]:
        return "send"

    async def send(self, value: JsonValue) -> None:
        if self._sealed or self._close_task is not None:
            raise OperationError("DISCONNECTED", "Channel writer is closed")
        value = normalize_json1(value)
        self._used = True
        self._sends += 1
        def settled(*_args: Any) -> None:
            self._sends -= 1
        await self._runtime._send_request(
            "channel/send", "channel/send", {"endpoint": self._reference, "value": value},
            on_settle=settled, on_admission_failure=settled,
        )

    async def close(self) -> None:
        self._used = True
        if self._sealed:
            return
        if self._sends:
            raise OperationError("INVALID_INPUT", "Channel writer has unsettled sends")
        if self._close_task is None:
            async def seal() -> None:
                await self._runtime._send_request("channel/close", "channel/close",
                                                 {"endpoint": self._reference}, settlement=True)
                self._sealed = True
            self._close_task = self._runtime._track_settlement(seal())
        await asyncio.shield(self._close_task)


class _Receiver(_Endpoint):
    def __init__(self, runtime: _Runtime, grant: dict[str, Any]):
        super().__init__(runtime, grant)
        self._start_sequence: int = grant["startSequence"]
        self._last_sequence = self._start_sequence - 1
        self._iterated = False
        self._ended = False
        self._disposed = False
        self._released = False
        self._cause: OperationError | None = None
        self._exposed = False
        self._read_task: asyncio.Task[Any] | None = None
        self._read_settled = asyncio.Event()
        self._read_settled.set()
        self._release_task: asyncio.Task[Any] | None = None

    @property
    def direction(self) -> Literal["receive"]:
        return "receive"

    @property
    def start_sequence(self) -> int:
        return self._start_sequence

    def __aiter__(self) -> _Receiver:
        if self._iterated:
            raise OperationError("OPERATION_CONFLICT", "Channel has one iterator")
        self._iterated = True
        self._used = True
        return self

    def _record_cause(self, cause: OperationError) -> None:
        if self._cause is None and not (self._disposed and cause.code == "CANCELLED"):
            self._cause = cause

    def _settle_read(self, result: Any, is_error: bool) -> None:
        try:
            if is_error:
                self._record_cause(result)
            elif "item" in result:
                sequence = result["item"]["sequence"]
                if sequence != self._last_sequence + 1:
                    raise ValueError("Noncontiguous channel sequence")
                self._last_sequence = sequence
            else:
                if result["end"]["lastSequence"] != self._last_sequence:
                    raise ValueError("Channel end disagrees with delivered prefix")
                self._ended = True
        finally:
            self._read_settled.set()

    async def __anext__(self) -> JsonValue:
        if self._cause is not None:
            self._exposed = True
            raise self._cause
        if self._disposed or self._ended:
            raise StopAsyncIteration
        if self._read_task is not None or not self._read_settled.is_set():
            raise OperationError("OPERATION_CONFLICT", "Channel already has a pending read")
        self._used = True
        self._read_settled.clear()
        self._read_task = asyncio.current_task()
        try:
            result = await self._runtime._send_request(
                "channel/next", "channel/next", {"endpoint": self._reference},
                on_settle=self._settle_read,
                on_admission_failure=self._read_settled.set,
            )
            if "end" in result:
                raise StopAsyncIteration
            return cast(JsonValue, result["item"]["value"])
        except asyncio.CancelledError:
            self._begin_release()
            raise
        except OperationError as error:
            if error is self._cause:
                self._exposed = True
            raise
        finally:
            self._read_task = None

    def _begin_release(self) -> asyncio.Task[Any]:
        self._used = True
        self._disposed = True
        if self._release_task is None:
            if self._read_task is not None and self._read_task is not asyncio.current_task():
                self._read_task.cancel()

            async def dispose() -> None:
                result = await self._runtime._send_request(
                    "channel/release", "channel/release", {"endpoint": self._reference},
                    settlement=True,
                )
                if (result["status"] == "ended"
                    and result["lastSequence"] < self._start_sequence - 1):
                    await self._runtime._fatal_close("PROTOCOL_ERROR")
                    raise OperationError("PROTOCOL_ERROR", "Channel release precedes its subscription")
                self._released = True
                if result["status"] == "failed":
                    self._record_cause(OperationError(result["code"], details=result.get("details")))
                await self._read_settled.wait()
                if result["status"] == "ended":
                    # Release need not deliver queued data; authoritative end
                    # may follow a prefix deliberately discarded by disposal.
                    # It cannot precede any already committed read, including
                    # a read whose response raced with this release response.
                    if (result["lastSequence"] < self._last_sequence
                        or (self._ended and result["lastSequence"] != self._last_sequence)):
                        await self._runtime._fatal_close("PROTOCOL_ERROR")
                        raise OperationError("PROTOCOL_ERROR", "Inconsistent channel release end")

            self._release_task = self._runtime._track_settlement(dispose())
        return self._release_task

    async def aclose(self) -> None:
        if self._ended and self._release_task is None:
            return
        try:
            await asyncio.shield(self._begin_release())
        except OperationError:
            # Ownership failures cannot be mistaken for successful disposal.
            raise
        if self._cause is not None and not self._exposed:
            self._exposed = True
            raise self._cause

    async def __aenter__(self) -> _Receiver:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        await self.aclose()


@dataclass(frozen=True, slots=True)
class _Pair:
    send: _Sender
    receive: _Receiver


@dataclass(frozen=True, slots=True)
class _Broadcast:
    send: _Sender
    _runtime: _Runtime
    _reference: str

    async def subscribe(self) -> _Receiver:
        return await self._runtime._subscribe(self)
