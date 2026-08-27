from __future__ import annotations

import asyncio
import os

from flowmd_sdk import ServiceDefinition, ServiceError, serve_service


async def sessions(context):
    if context.method == "echo":
        return context.input
    if context.method == "missing":
        raise ServiceError("not-found", context.input)
    if context.method == "dependency":
        return await context.call_effect(
            operation_id="storage:1",
            slot="storage",
            method="read",
            input=context.input,
        )
    if context.method == "slow":
        await asyncio.Event().wait()
    return None


async def mount(context):
    await context.ready()
    await context.cancelled()


serve_service(ServiceDefinition(
    exports={} if os.environ.get("FLOWMD_TEST_EMPTY_SERVICE") == "1" else {"sessions": sessions},
    mount=mount,
))
