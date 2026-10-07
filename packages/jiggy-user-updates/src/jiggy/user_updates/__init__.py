"""Optional complete notices and transient activity snapshots for FLOW."""
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import weakref
from decimal import Decimal
from importlib.resources import files
from types import MappingProxyType
from typing import Any, Literal, Mapping, Required, TypedDict

from jiggy.flow import ChannelSender, OperationError, RunContext
from .view import ViewOptions, ViewSnapshot, Reference, validate_view, operation, record


class Progress(TypedDict, total=False):
    completed: Required[int]
    total: int
    unit: str


def _canonical(value: Any) -> bytes:
    # RFC 8785 accounting for already validated JSON/0. Python's JSON encoder
    # uses padded exponents and a different decimal threshold than ECMAScript.
    def encode(v: Any) -> str:
        if type(v) is dict:
            keys=sorted(v,key=lambda key:key.encode('utf-16be'))
            return '{'+','.join(encode(k)+':'+encode(v[k]) for k in keys)+'}'
        if type(v) is list: return '['+','.join(encode(item) for item in v)+']'
        if type(v) is float:
            if v == 0: return '0'
            if v.is_integer(): return str(int(v))
            shortest=repr(v)
            if abs(v)>=1e-6: return format(Decimal(shortest),'f')
            mantissa,separator,exponent=shortest.partition('e')
            return mantissa+('e'+str(int(exponent)) if separator else '')
        return json.dumps(v,ensure_ascii=False,separators=(',',':'),allow_nan=False)
    return encode(value).encode('utf-8')


_descriptor = json.loads(files(__package__).joinpath("user-updates.json").read_bytes())
USER_UPDATES_CONTRACT: Mapping[str, str] = MappingProxyType({
    "id": _descriptor["id"], "version": _descriptor["version"],
    "digest": "sha256:" + hashlib.sha256(b"FLOW-Channel-Contract/0\0" + _canonical(_descriptor)).hexdigest(),
})
_claims: weakref.WeakSet[Any] = weakref.WeakSet()


def _record(value: Any, fields: set[str]) -> dict[str, Any]:
    if type(value) is not dict or any(type(key) is not str or key not in fields for key in value):
        raise TypeError("Unknown or non-object user update fields")
    return value


def _text(value: Any, maximum: int, single_line: bool = False) -> str:
    if type(value) is not str or not 1 <= len(value) <= maximum:
        raise TypeError("User update text exceeds its length limit")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise TypeError("User update text must contain Unicode scalars") from error
    if single_line and any(char in value for char in "\r\n\u2028\u2029"):
        raise TypeError("User update label or unit must fit one logical line")
    return value


def _count(value: Any) -> int:
    if type(value) not in (int, float) or not 0 <= value <= 9007199254740991 or value != int(value):
        raise TypeError("User update count must be a safe nonnegative integer")
    return int(value)


def validate_user_update(value: Any) -> dict[str, Any]:
    """Validate unknown input and return a private JSON snapshot."""
    root = _record(value, {"kind", "text", "severity", "id", "label", "progress", "detail", "operationId", "title", "summary", "landing", "sections"})
    kind = root.get("kind")
    if type(kind) is not str:
        raise TypeError("Unknown user update kind")
    result: dict[str, Any]
    if kind == "notice":
        _record(root, {"kind", "text", "severity"})
        result = {"kind": kind, "text": _text(root.get("text"), 4096)}
        if "severity" in root:
            severity = root["severity"]
            if type(severity) is not str or severity not in ("info", "warning", "error"):
                raise TypeError("Unknown notice severity")
            result["severity"] = severity
    elif kind == "clear":
        _record(root, {"kind", "id"})
        result = {"kind": kind, "id": _text(root.get("id"), 64, True)}
    elif kind == "activity":
        _record(root, {"kind", "id", "label", "progress", "detail", "operationId"})
        result = {"kind": kind, "id": _text(root.get("id"), 64, True), "label": _text(root.get("label"), 256, True)}
        if 'detail' in root: result['detail'] = _text(root['detail'],4096)
        if 'operationId' in root: result['operationId'] = operation(root['operationId'])
        if "progress" in root:
            p = _record(root["progress"], {"completed", "total", "unit"})
            progress: dict[str, Any] = {"completed": _count(p.get("completed"))}
            if "total" in p:
                progress["total"] = _count(p["total"])
                if progress["completed"] > progress["total"]:
                    raise TypeError("Completed count exceeds total")
            if "unit" in p:
                progress["unit"] = _text(p["unit"], 32, True)
            result["progress"] = progress
    elif kind == 'view':
        result = validate_view(root)
    elif kind == 'retire-view':
        _record(root, {'kind','id'})
        result = {'kind':kind,'id':_text(root.get('id'),64,True)}
    else:
        raise TypeError("Unknown user update kind")
    if len(_canonical(result)) > 32768:
        raise TypeError("Encoded user update exceeds 32 KiB")
    return result


class UserView:
    """One scope-owned local view handle; declarations allocate no host resources."""
    def __init__(self, owner: UserUpdates, identity: dict[str, Any]):
        self._owner, self._identity = owner, identity
        self._retired = self._published = False

    def update(self, snapshot: ViewSnapshot) -> None:
        value = validate_user_update({**self._identity, **record(snapshot,{'title','summary','sections'})})
        if self._retired: raise RuntimeError('View has been retired')
        if self._identity.get('landing') and self._owner._landing not in (None,self._identity['id']):
            raise TypeError('Only one view may nominate a landing hint')
        self._owner._offer(value)
        if self._identity.get('landing'): self._owner._landing = self._identity['id']
        self._published = True

    def retire(self) -> None:
        if self._retired: return
        if self._owner._phase != 'accepting': raise RuntimeError('User updates scope is no longer accepting offers')
        if self._published: self._owner._offer({'kind':'retire-view','id':self._identity['id']})
        self._retired = True


class UserUpdates:
    """Scope-owned publisher. Offers are synchronous; scope exit owns settlement."""

    def __init__(self, sender: ChannelSender | None):
        self._sender = sender
        self._phase = "accepting"
        self._enabled = sender is not None
        self._queue: list[tuple[dict[str, Any], int]] = []
        self._retained = self._bytes = self._attempts = self._traffic = 0
        self._notices = self._notice_bytes = 0
        self._keys: set[str] = set()
        self._view_ids: set[str] = set()
        self._activity_calls: dict[str, str | None] = {}
        self._landing: str | None = None
        self._pump: asyncio.Task[None] | None = None
        self._close: asyncio.Task[None] | None = None
        self._failure: BaseException | None = None
        self._next_send = 0.0
        self._stopped = asyncio.Event()

    def notice(self, text: str, severity: Literal["info", "warning", "error"] | None = None) -> None:
        self._offer({"kind": "notice", "text": text, **({} if severity is None else {"severity": severity})})

    def activity(self, id: str, label: str, progress: Progress | None = None, *, detail: str | None = None, operation_id: str | None = None) -> None:
        value: dict[str, Any] = {"kind": "activity", "id": id, "label": label}
        if progress is not None:
            value["progress"] = progress
        if detail is not None: value['detail'] = detail
        if operation_id is not None: value['operationId'] = operation_id
        validate_user_update(value)
        if id in self._activity_calls and self._activity_calls[id] != operation_id:
            raise TypeError('Activity call association is fixed until clear')
        self._offer(value)
        if self._enabled: self._activity_calls[id] = operation_id

    def clear(self, id: str) -> None:
        self._offer({"kind": "clear", "id": id})
        self._activity_calls.pop(id, None)

    def view(self, id: str, options: ViewOptions) -> UserView:
        declaration = validate_view({'kind':'view','id':id,**record(options,{'title','landing','operationId'}),'summary':'Declaration','sections':[]})
        if self._phase != 'accepting': raise RuntimeError('User updates scope is no longer accepting offers')
        if id in self._view_ids: raise RuntimeError('View ID already has a scope owner')
        if len(self._view_ids) >= 16: raise RuntimeError('View ID claim limit exceeded')
        self._view_ids.add(id)
        declaration.pop('summary')
        declaration.pop('sections')
        return UserView(self, declaration)

    def _offer(self, input: Any) -> None:
        value = validate_user_update(input)
        size = len(_canonical(value))
        if self._phase != "accepting":
            raise RuntimeError("User updates scope is no longer accepting offers")
        if not self._enabled:
            return
        tail = self._queue[-1] if self._queue else None
        replace = tail is not None and value["kind"] in ('activity','view') and tail[0]["kind"] == value["kind"] and tail[0]["id"] == value["id"]
        prior = tail[1] if replace and tail is not None else 0
        if value["kind"] == "notice":
            self._notices += 1
            self._notice_bytes += size
            if self._notices > 128 or self._notice_bytes > 524288:
                self._stop()
                return
        if value["kind"] == "activity":
            self._keys.add(value["id"])
            if len(self._keys) > 16:
                self._stop()
                return
        elif value["kind"] == "clear":
            self._keys.discard(value["id"])
        if self._retained + (0 if replace else 1) > 16 or self._bytes - prior + size > 262144:
            self._stop()
            return
        if replace:
            self._queue[-1] = (value, size)
        else:
            self._queue.append((value, size))
            self._retained += 1
        self._bytes += size - prior
        if self._pump is None:
            self._pump = asyncio.create_task(self._run())

    def _inspect(self, error: BaseException) -> None:
        if isinstance(error, OperationError) and error.code in ("LAGGED", "DISCONNECTED"):
            return
        if self._failure is None:
            self._failure = error

    def _stop(self) -> None:
        if not self._enabled:
            return
        self._enabled = False
        for _, size in self._queue:
            self._retained -= 1
            self._bytes -= size
        self._queue.clear()
        self._keys.clear()
        self._activity_calls.clear()
        self._stopped.set()
        if self._sender is not None and self._close is None:
            self._close = asyncio.create_task(self._sender.close(error="LAGGED"))
            # Retrieve errors promptly; the task itself remains owned and joined at exit.
            self._close.add_done_callback(lambda task: task.exception() if not task.cancelled() else None)

    async def _run(self) -> None:
        try:
            while self._enabled and self._queue:
                delay = self._next_send - asyncio.get_running_loop().time()
                if delay > 0:
                    try:
                        await asyncio.wait_for(self._stopped.wait(), delay)
                    except TimeoutError:
                        pass
                if not self._enabled:
                    break
                value, size = self._queue.pop(0)
                self._attempts += 1
                self._traffic += size
                if self._attempts > 4096 or self._traffic > 4194304:
                    self._retained -= 1
                    self._bytes -= size
                    self._stop()
                    break
                self._next_send = asyncio.get_running_loop().time() + 0.2
                assert self._sender is not None
                original = asyncio.create_task(self._sender.send(value))
                # wait() does not cancel the original operation on local timeout.
                done, _ = await asyncio.wait({original}, timeout=0.5)
                if not done:
                    self._stop()
                try:
                    await original
                except BaseException as error:
                    self._inspect(error)
                    self._stop()
                finally:
                    self._retained -= 1
                    self._bytes -= size
        except BaseException as error:
            self._inspect(error)
            self._stop()
        finally:
            self._pump = None

    async def _finish(self) -> None:
        if self._phase == "finished":
            return
        self._phase = "draining"
        pump = self._pump
        if pump is not None:
            done, _ = await asyncio.wait({pump}, timeout=4.0)
            if not done:
                self._stop()
            await pump
        if self._sender is not None and self._close is None:
            self._close = asyncio.create_task(self._sender.close())
        if self._close is not None:
            try:
                await self._close
            except BaseException as error:
                self._inspect(error)
        self._phase = "finished"
        self._enabled = False
        self._keys.clear()
        if self._failure is not None:
            raise self._failure


class user_updates:
    """Own one optional writer until scope exit, including original send settlement."""

    def __init__(self, run: RunContext, channel: str):
        self._run, self._channel = run, channel
        self._publisher: UserUpdates | None = None

    async def __aenter__(self) -> UserUpdates:
        endpoint = self._run.channels.get(self._channel)
        if endpoint is not None:
            identity = endpoint.contract
            if endpoint.direction != "send" or identity is None or any(identity.get(key) != value for key, value in USER_UPDATES_CONTRACT.items()):
                raise TypeError("User updates requires a sender with the exact supported contract")
            if endpoint in _claims:
                raise RuntimeError("User updates writer already has a scope owner")
            _claims.add(endpoint)
        self._publisher = UserUpdates(endpoint)
        return self._publisher

    async def __aexit__(self, exc_type: Any, exc: BaseException | None, traceback: Any) -> bool:
        assert self._publisher is not None
        self._publisher._phase = "draining"
        if isinstance(exc, asyncio.CancelledError):
            self._publisher._stop()
        cleanup = asyncio.create_task(self._publisher._finish())
        interrupted: asyncio.CancelledError | None = None
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError as error:
                interrupted = error
                self._publisher._stop()
            except BaseException:
                break
        try:
            cleanup.result()
        except BaseException:
            if exc is None and interrupted is None:
                raise
            print("User updates publisher also failed; the application error remains primary.", file=sys.stderr)
        if interrupted is not None:
            raise interrupted
        return False


__all__ = ["Progress", "USER_UPDATES_CONTRACT", "UserUpdates", "user_updates", "validate_user_update"]
