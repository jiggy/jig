from __future__ import annotations

import asyncio
import sys

from jiggy.flow import CapabilityError, OperationError, RunContext, RunResult, handle


logged = False


async def run(context: RunContext) -> RunResult:
    global logged
    mode = context.input.get("mode") if isinstance(context.input, dict) else None

    if mode == "broadcast-abandoned":
        source = await context.channel(delivery="broadcast")
        await source.subscribe()
        return {"outcome": "done", "output": "not allowed"}

    if mode in ("broadcast-cancel-create", "broadcast-cancel-subscribe"):
        if mode == "broadcast-cancel-create":
            allocating = asyncio.create_task(context.channel(delivery="broadcast"))
        else:
            source = await context.channel(delivery="broadcast")
            allocating = asyncio.create_task(source.subscribe())
        await asyncio.sleep(0.05)
        allocating.cancel()
        await asyncio.gather(allocating, return_exceptions=True)
        return {"outcome": "done", "output": "cancelled"}

    if mode == "channels":
        pair = await context.channel(contract="./contracts/public-updates.json")
        work = asyncio.create_task(context.call_capability(
            operation_id="agent:1", slot="agent", method="run", input={},
            channels={"events": pair.send},
        ))
        complete = True
        try:
            async with pair.receive:
                async for value in pair.receive:
                    if isinstance(value, dict) and value.get("public"):
                        print(value["text"], flush=True)
        except OperationError as error:
            if error.code != "LAGGED":
                raise
            complete = False
        return {"outcome": "done", "output": {"complete": complete, "agent": await work}}

    if mode in ("channel-cancel-read", "channel-cancel-close"):
        pair = await context.channel()
        read = asyncio.create_task(anext(pair.receive))
        await asyncio.sleep(0.05)
        read.cancel()
        try:
            await read
        except asyncio.CancelledError:
            pass
        if mode == "channel-cancel-close":
            closing = asyncio.create_task(pair.receive.aclose())
            await asyncio.sleep(0.05)
            closing.cancel()
            try:
                await closing
            except asyncio.CancelledError:
                pass
        try:
            await pair.receive.aclose()
        except OperationError as error:
            await pair.receive.aclose()
            return {"outcome": "done", "output": error.code}
        return {"outcome": "done", "output": "disposed"}

    if mode == "channel-cancel-create":
        creating = asyncio.create_task(context.channel())
        await asyncio.sleep(0.05)
        creating.cancel()
        try:
            await creating
        except asyncio.CancelledError:
            pass
        return {"outcome": "done", "output": "cancelled"}

    if mode in ("channel-unused", "channel-abandoned", "channel-bad-result"):
        pair = await context.channel()
        if mode == "channel-abandoned":
            aiter(pair.receive)
        if mode == "channel-bad-result":
            await pair.send.send("before invalid result")
            return {"outcome": "done", "output": float("nan")}
        return {"outcome": "done", "output": "finished"}

    if mode == "channel-inherited":
        values = []
        async for value in context.channels["input"]:
            values.append(value)
        return {"outcome": "done", "output": values}

    if mode == "channel-unsupported":
        try:
            await context.channel(delivery="websocket")  # type: ignore[call-overload]
        except OperationError as error:
            return {"outcome": "done", "output": error.code}

    if mode == "channel-caught-child":
        try:
            await context.run_child_flow(operation_id="child:1", slot="child", input={})
        except OperationError:
            return {"outcome": "done", "output": "recovered"}

    if mode == "context":
        return {"outcome": "done", "output": {
            "settings": context.settings, "attachments": context.attachments,
            "scratch": context.scratch, "deadline": context.deadline_unix_ms,
        }}

    if mode == "invalid-result":
        return {"outcome": "done", "output": float("nan")}

    if mode == "snapshot":
        value = {"nested": ["before"]}
        task = asyncio.create_task(context.run_child_flow(
            operation_id="snapshot-1", slot="child", input=value,
        ))
        await asyncio.sleep(0)  # Admit and snapshot the call before mutation.
        value["nested"][0] = "after"
        result = await task
        return {"outcome": "done", "output": result}

    if mode == "logging":
        print("handler print")
        print("handler flush", flush=True)
        sys.stdout.write("handler stdout write\n")
        sys.stdout.flush()
        logged = True
        return {"outcome": "done", "output": "logged"}

    if mode == "calls":
        child = await context.run_child_flow(
            operation_id="child:1",
            slot="child",
            intent="Exercise a child Flow call.",
            input={"value": 1},
        )
        try:
            await context.call_capability(
                operation_id="effect:1",
                slot="store",
                method="read",
                input={"key": "missing"},
            )
        except CapabilityError as error:
            effect = {"name": error.error_name, "data": error.data}
        else:
            raise AssertionError("fixture expected a declared CapabilityError")
        # A child result is itself ordinary JSON and may be embedded directly
        # in another result.
        return {"outcome": "done", "output": {"child": child, "effect": effect}}

    if mode == "cancel":
        await asyncio.Event().wait()
        raise AssertionError("cancelled handler resumed")

    if mode == "swallow-cancel":
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            try:
                await context.call_capability(
                    operation_id="after-cancel:1",
                    slot="store",
                    method="read",
                    input={},
                )
            except OperationError as error:
                if error.code != "OWNER_CLOSED":
                    raise
        return {"outcome": "done", "output": "must-not-succeed"}

    if mode == "swallow-cancel-error":
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            raise RuntimeError("must not override cancellation")

    if mode == "parallel":
        child = asyncio.create_task(
            context.run_child_flow(
                operation_id="child:parallel",
                slot="child",
                input={"value": 1},
            )
        )
        effect = asyncio.create_task(
            context.call_capability(
                operation_id="effect:parallel",
                slot="store",
                method="read",
                input={"key": "present"},
            )
        )
        child_result, effect_result = await asyncio.gather(child, effect)
        return {
            "outcome": "done",
            "output": {"child": child_result["output"], "effect": effect_result},
        }

    if mode == "cancel-call":
        call = asyncio.create_task(
            context.run_child_flow(
                operation_id="child:cancelled",
                slot="child",
                input={},
            )
        )
        await asyncio.sleep(0.05)
        call.cancel()
        try:
            await call
        except asyncio.CancelledError:
            pass
        return {"outcome": "done", "output": "cancelled-locally"}

    if mode == "cancel-pending":
        await context.run_child_flow(
            operation_id="child:root-cancelled",
            slot="child",
            input={},
        )
        raise AssertionError("cancelled child call resumed")

    if mode == "detached":
        asyncio.create_task(
            context.run_child_flow(
                operation_id="child:detached",
                slot="child",
                input={},
            )
        )
        await asyncio.sleep(0.05)
        return {"outcome": "done", "output": "must-not-succeed"}

    if mode == "error-with-detached":
        asyncio.create_task(
            context.run_child_flow(
                operation_id="child:error-detached",
                slot="child",
                input={},
            )
        )
        await asyncio.sleep(0.05)
        raise OperationError("INVALID_INPUT", "committed failure")

    if mode == "operation-error":
        raise OperationError(
            "INVALID_INPUT",
            "The input is not usable.",
            {"field": "input"},
        )

    if mode == "invalid-operation-details":
        raise OperationError(
            "INVALID_INPUT",
            details=object(),  # type: ignore[arg-type]
        )

    if mode == "empty-operation-message":
        raise OperationError("INVALID_INPUT", "")

    if mode == "long-operation-message":
        raise OperationError("INVALID_INPUT", "x" * 1_025)

    if mode == "surrogate-operation-message":
        raise OperationError("INVALID_INPUT", "\ud800")

    if mode == "local-operation-code":
        raise OperationError("PROTOCOL_ERROR", "must stay local")

    if mode == "unhashable-operation-code":
        error = OperationError("INVALID_INPUT")
        error.code = []  # type: ignore[assignment]
        raise error

    if mode == "bad-diagnostic":
        raise RuntimeError("\ud800")

    if mode == "large-diagnostic":
        raise RuntimeError("x" * 200_000)

    return {"outcome": "done", "output": context.input}


handle(run)
if logged:
    print("after handle")
