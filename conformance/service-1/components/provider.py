from __future__ import annotations

import asyncio

from flowmd_sdk import OperationError, ServiceDefinition, ServiceError, serve_service


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
    if context.method == "detached":
        task = asyncio.create_task(context.call_effect(
            operation_id="detached:1",
            slot="storage",
            method="read",
            input=context.input,
        ))
        task.add_done_callback(lambda completed: completed.exception())
        await asyncio.sleep(0)
        return "must-not-succeed"
    if context.method == "fanout":
        settled = await asyncio.gather(*(
            context.call_effect(
                operation_id=f"fanout:{index}",
                slot="storage",
                method="read",
                input=index,
            )
            for index in range(65)
        ), return_exceptions=True)
        return [
            item.code if isinstance(item, OperationError) else "ok"
            for item in settled
        ]
    if context.method == "slow":
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            return "caught-cancellation"
    return None


async def mount(context):
    if context.settings.get("initialize") is True:
        await context.call_effect(
            operation_id="initialize:1",
            slot="storage",
            method="open",
            input=None,
        )
    await context.ready()
    await context.cancelled()


serve_service(ServiceDefinition(
    exports={"sessions": sessions},
    mount=mount,
))
