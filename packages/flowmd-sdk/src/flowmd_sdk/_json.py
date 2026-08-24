from __future__ import annotations

import json
import math
from collections.abc import Mapping
from typing import Any


MAX_DOCUMENT_BYTES = 16_777_216
MAX_DEPTH = 128
MAX_NODES = 262_144
MAX_OBJECT_MEMBERS = 65_536
MAX_ARRAY_ITEMS = 65_536
MAX_STRING_BYTES = 8_388_608
MAX_MEMBER_NAME_BYTES = 1_024
MAX_NUMBER_TOKEN_BYTES = 128
MAX_SAFE_INTEGER = 9_007_199_254_740_991


class Json1Error(ValueError):
    def __init__(self, message: str, *, best_effort_parse_error: bool = True):
        self.best_effort_parse_error = best_effort_parse_error
        super().__init__(message)


def _reject_constant(token: str) -> None:
    raise Json1Error(f"non-finite number token: {token}")


def _parse_number(token: str) -> int | float:
    if len(token.encode("ascii")) > MAX_NUMBER_TOKEN_BYTES:
        raise Json1Error("number token exceeds the JSON/1 limit")

    value = float(token)
    if not math.isfinite(value):
        raise Json1Error("number is not finite binary64")
    if value.is_integer():
        if abs(value) > MAX_SAFE_INTEGER:
            raise Json1Error("integral number exceeds the JSON/1 safe range")
        return int(value)
    return value


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise Json1Error(f"duplicate object member: {key!r}")
        result[key] = value
    return result


def _string_bytes(value: str, *, member_name: bool = False) -> int:
    try:
        size = len(value.encode("utf-8", "strict"))
    except UnicodeEncodeError as error:
        raise Json1Error("lone Unicode surrogate") from error

    limit = MAX_MEMBER_NAME_BYTES if member_name else MAX_STRING_BYTES
    if size > limit:
        kind = "member name" if member_name else "string"
        raise Json1Error(f"{kind} exceeds the JSON/1 limit")
    return size


def normalize_json1(value: Any) -> Any:
    """Validate a Python value as JSON/1 and return plain JSON containers."""

    nodes = 0
    active: set[int] = set()

    def visit(current: Any, depth: int) -> Any:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_NODES:
            raise Json1Error("value exceeds the JSON/1 node limit")
        if depth > MAX_DEPTH:
            raise Json1Error("value exceeds the JSON/1 depth limit")

        if current is None or isinstance(current, bool):
            return current
        if isinstance(current, str):
            _string_bytes(current)
            return current
        if isinstance(current, int):
            if abs(current) > MAX_SAFE_INTEGER:
                raise Json1Error("integral number exceeds the JSON/1 safe range")
            return current
        if isinstance(current, float):
            if not math.isfinite(current):
                raise Json1Error("number is not finite binary64")
            if current.is_integer():
                if abs(current) > MAX_SAFE_INTEGER:
                    raise Json1Error("integral number exceeds the JSON/1 safe range")
                return int(current)
            return current

        if isinstance(current, Mapping):
            identity = id(current)
            if identity in active:
                raise Json1Error("cyclic object is not JSON")
            if len(current) > MAX_OBJECT_MEMBERS:
                raise Json1Error("object exceeds the JSON/1 member limit")
            active.add(identity)
            try:
                result: dict[str, Any] = {}
                for key, child in current.items():
                    if not isinstance(key, str):
                        raise Json1Error("JSON object member names must be strings")
                    _string_bytes(key, member_name=True)
                    result[key] = visit(child, depth + 1)
                return result
            finally:
                active.remove(identity)

        if isinstance(current, (list, tuple)):
            identity = id(current)
            if identity in active:
                raise Json1Error("cyclic array is not JSON")
            if len(current) > MAX_ARRAY_ITEMS:
                raise Json1Error("array exceeds the JSON/1 item limit")
            active.add(identity)
            try:
                return [visit(child, depth + 1) for child in current]
            finally:
                active.remove(identity)

        raise Json1Error(f"unsupported JSON value: {type(current).__name__}")

    return visit(value, 1)


def parse_json1(payload: bytes) -> Any:
    if len(payload) > MAX_DOCUMENT_BYTES:
        raise Json1Error("document exceeds the JSON/1 byte limit")
    if payload.startswith(b"\xef\xbb\xbf"):
        # A BOM is valid UTF-8 but outside JSON/1. It therefore receives the
        # same best-effort parse error as any other complete JSON/1 violation.
        raise Json1Error("UTF-8 BOM is not allowed")
    try:
        text = payload.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise Json1Error("invalid UTF-8", best_effort_parse_error=False) from error

    try:
        value = json.loads(
            text,
            object_pairs_hook=_object,
            parse_int=_parse_number,
            parse_float=_parse_number,
            parse_constant=_reject_constant,
        )
    except Json1Error:
        raise
    except (ValueError, TypeError, RecursionError) as error:
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
    if len(payload) > MAX_DOCUMENT_BYTES:
        raise Json1Error("encoded document exceeds the JSON/1 byte limit")
    return payload
