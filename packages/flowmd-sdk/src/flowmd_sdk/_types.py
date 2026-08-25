from __future__ import annotations

from collections.abc import Mapping
from typing import Awaitable, Callable, Literal, Protocol, TypeAlias, TypedDict


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


class EffectError(Exception):
    """A capability returned one of its declared application errors."""

    def __init__(self, error_name: str, data: JsonValue):
        self.error_name = error_name
        self.data = data
        super().__init__(error_name)


class ServiceError(Exception):
    """A Service Provider returned a contract-declared application error."""

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

    async def call_flow(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
    ) -> RunResult: ...

    async def call_effect(
        self,
        *,
        operation_id: str,
        slot: str,
        method: str,
        input: JsonValue,
    ) -> JsonValue: ...


RunHandler: TypeAlias = Callable[[RunContext], Awaitable[RunResult]]


class ServiceOwnerContext(Protocol):
    async def call_flow(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
    ) -> RunResult: ...

    async def call_effect(
        self,
        *,
        operation_id: str,
        slot: str,
        method: str,
        input: JsonValue,
    ) -> JsonValue: ...


class ServiceMountContext(ServiceOwnerContext, Protocol):
    @property
    def settings(self) -> Mapping[str, JsonValue]: ...

    @property
    def attachments(self) -> Mapping[str, Attachment]: ...

    @property
    def scratch(self) -> str: ...

    @property
    def startup_deadline_unix_ms(self) -> int: ...

    async def ready(self) -> None: ...

    async def cancelled(self) -> None: ...


class ServiceInvocationContext(ServiceOwnerContext, Protocol):
    @property
    def export_name(self) -> str: ...

    @property
    def method(self) -> str: ...

    @property
    def input(self) -> JsonValue: ...

    @property
    def deadline_unix_ms(self) -> int: ...


ServiceMountHandler: TypeAlias = Callable[[ServiceMountContext], Awaitable[None]]
ServiceExportHandler: TypeAlias = Callable[[ServiceInvocationContext], Awaitable[JsonValue]]


class ServiceDefinition:
    """One fixed Service export map and one Mount lifetime handler."""

    __slots__ = ("exports", "mount")

    def __init__(
        self,
        *,
        exports: Mapping[str, ServiceExportHandler],
        mount: ServiceMountHandler,
    ) -> None:
        self.exports = exports
        self.mount = mount
