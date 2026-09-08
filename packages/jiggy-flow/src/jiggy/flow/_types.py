from __future__ import annotations

from collections.abc import Mapping
from typing import AsyncIterator, Awaitable, Callable, Literal, Protocol, TypeAlias, TypedDict


JsonScalar: TypeAlias = None | bool | int | float | str
JsonValue: TypeAlias = (
    JsonScalar
    | list["JsonValue"]
    | tuple["JsonValue", ...]
    | Mapping[str, "JsonValue"]
)
JsonObject: TypeAlias = Mapping[str, JsonValue]
AttachmentAccess: TypeAlias = Literal["read", "read-write"]
OperationErrorCode: TypeAlias = Literal[
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
    "PROTOCOL_ERROR",
    "CHANNEL_LOST",
    "LAGGED",
    "DISCONNECTED",
]


class OperationError(Exception):
    """A Run/1 operation failed outside a capability's declared error set."""

    def __init__(
        self,
        code: OperationErrorCode,
        message: str | None = None,
        details: JsonValue = None,
    ):
        self.code = code
        self.message = code if message is None else message
        self.details = details
        super().__init__(self.message)


class CapabilityError(Exception):
    """A capability returned one of its declared application errors."""

    def __init__(self, error_name: str, data: JsonValue):
        self.error_name = error_name
        self.data = data
        super().__init__(error_name)


class Attachment(TypedDict):
    path: str
    access: AttachmentAccess


class RunResult(TypedDict):
    outcome: str
    output: JsonValue


class ChannelContractIdentity(TypedDict):
    id: str
    version: str
    digest: str


class ChannelSender(Protocol):
    @property
    def direction(self) -> Literal["send"]: ...

    @property
    def delivery(self) -> Literal["direct"]: ...

    @property
    def contract(self) -> ChannelContractIdentity | None: ...

    async def send(self, value: JsonValue) -> None: ...

    async def close(self) -> None: ...


class ChannelReceiver(Protocol):
    @property
    def direction(self) -> Literal["receive"]: ...

    @property
    def delivery(self) -> Literal["direct"]: ...

    @property
    def contract(self) -> ChannelContractIdentity | None: ...

    @property
    def start_sequence(self) -> int: ...

    def __aiter__(self) -> AsyncIterator[JsonValue]: ...

    async def __anext__(self) -> JsonValue: ...

    async def aclose(self) -> None: ...

    async def __aenter__(self) -> ChannelReceiver: ...

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None: ...


ChannelEndpoint: TypeAlias = ChannelSender | ChannelReceiver


class ChannelPair(Protocol):
    @property
    def send(self) -> ChannelSender: ...

    @property
    def receive(self) -> ChannelReceiver: ...


class RunContext(Protocol):
    @property
    def input(self) -> JsonValue: ...

    @property
    def settings(self) -> Mapping[str, JsonValue]: ...

    @property
    def attachments(self) -> Mapping[str, Attachment]: ...

    @property
    def scratch(self) -> str: ...

    @property
    def deadline_unix_ms(self) -> int: ...

    @property
    def channels(self) -> Mapping[str, ChannelEndpoint]: ...

    async def channel(
        self,
        *,
        delivery: Literal["direct"] = "direct",
        schema: JsonValue = ...,
        contract: str | None = None,
    ) -> ChannelPair: ...

    async def run_child_flow(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
        channels: Mapping[str, ChannelEndpoint] | None = None,
    ) -> RunResult: ...

    async def call_capability(
        self,
        *,
        operation_id: str,
        slot: str,
        method: str,
        input: JsonValue,
        channels: Mapping[str, ChannelEndpoint] | None = None,
    ) -> JsonValue: ...


RunHandler: TypeAlias = Callable[[RunContext], Awaitable[RunResult]]
