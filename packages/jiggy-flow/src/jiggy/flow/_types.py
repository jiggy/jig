from __future__ import annotations

from collections.abc import Mapping
from typing import AsyncIterator, Awaitable, Callable, Literal, NotRequired, Protocol, TypeAlias, TypedDict, overload


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
    """A Run/0 operation failed outside its normal declared outcomes."""

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


class Artifact(Protocol):
    """A host-supplied immutable tree held by one live invocation."""

    @property
    def reference(self) -> str: ...


class Attachment(TypedDict):
    path: str
    access: AttachmentAccess
    artifact: NotRequired[Artifact]


class RunResult(TypedDict):
    outcome: str
    output: JsonValue
    artifactResults: NotRequired[Mapping[str, Artifact]]


class CallResult(TypedDict):
    outcome: str
    output: JsonValue
    artifacts: NotRequired[Mapping[str, Artifact]]


class ReadAttachment(TypedDict):
    read: Artifact


class CreateAttachment(TypedDict):
    create: Literal[True]


CallAttachments: TypeAlias = Mapping[str, ReadAttachment | CreateAttachment]


class ChannelContractIdentity(TypedDict):
    id: str
    version: str
    digest: str


class ChannelSlotContract(TypedDict):
    slot: str
    channel: str


class ChannelSender(Protocol):
    @property
    def direction(self) -> Literal["send"]: ...

    @property
    def delivery(self) -> Literal["direct", "broadcast"]: ...

    @property
    def contract(self) -> ChannelContractIdentity | None: ...

    async def send(self, value: JsonValue) -> None: ...

    async def close(self, *, error: Literal["LAGGED"] | None = None) -> None: ...


class ChannelReceiver(Protocol):
    @property
    def direction(self) -> Literal["receive"]: ...

    @property
    def delivery(self) -> Literal["direct", "broadcast"]: ...

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


class ChannelBroadcast(Protocol):
    @property
    def send(self) -> ChannelSender: ...

    async def subscribe(self) -> ChannelReceiver: ...


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

    @overload
    async def channel(
        self,
        *,
        delivery: Literal["direct"] = "direct",
        schema: JsonValue = ...,
        contract: str | ChannelSlotContract | None = None,
    ) -> ChannelPair: ...

    @overload
    async def channel(
        self,
        *,
        delivery: Literal["broadcast"],
        schema: JsonValue = ...,
        contract: str | ChannelSlotContract | None = None,
    ) -> ChannelBroadcast: ...

    async def call(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
        channels: Mapping[str, ChannelEndpoint] | None = None,
        attachments: CallAttachments | None = None,
    ) -> CallResult: ...

    async def release(self, *, operation_id: str, artifact: Artifact) -> None: ...


RunHandler: TypeAlias = Callable[[RunContext], Awaitable[RunResult]]
