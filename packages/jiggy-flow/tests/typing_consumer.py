"""Type-check only against the installed public API."""
import asyncio
from typing import assert_type
from jiggy.flow import (
    Attachment, CapabilityError, JsonValue, OperationError,
    RunContext, RunHandler, RunResult, handle,
)

async def work(context: RunContext) -> RunResult:
    assert_type(context.input, JsonValue)
    assert_type(context.attachments["source"], Attachment)
    assert_type(context.deadline_unix_ms, int)
    try:
        child = await context.run_child_flow(operation_id="child-1", slot="child", input=context.input)
        assert_type(child, RunResult)
        value = await context.call_capability(operation_id="call-1", slot="service", method="read", input=None)
        assert_type(value, JsonValue)
        return {"outcome": "done", "output": value}
    except CapabilityError as error:
        return {"outcome": "blocked", "output": error.data}
    except OperationError as error:
        return {"outcome": "blocked", "output": error.code}
    except asyncio.CancelledError:
        raise

handler: RunHandler = work
handle(handler)
