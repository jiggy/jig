from __future__ import annotations

import asyncio

from flowmd_sdk import EffectError, OperationError, RunContext, RunResult, serve


async def run(context: RunContext) -> RunResult:
    mode = context.input.get("mode") if isinstance(context.input, dict) else None

    if mode == "calls":
        child = await context.call_flow(
            operation_id="child:1",
            slot="child",
            intent="Exercise a child Flow call.",
            input={"value": 1},
        )
        try:
            await context.call_effect(
                operation_id="effect:1",
                slot="store",
                method="read",
                input={"key": "missing"},
            )
        except EffectError as error:
            effect = {"name": error.error_name, "data": error.data}
        else:
            raise AssertionError("fixture expected a declared EffectError")
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
                await context.call_effect(
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
            context.call_flow(
                operation_id="child:parallel",
                slot="child",
                input={"value": 1},
            )
        )
        effect = asyncio.create_task(
            context.call_effect(
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
            context.call_flow(
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
        await context.call_flow(
            operation_id="child:root-cancelled",
            slot="child",
            input={},
        )
        raise AssertionError("cancelled child call resumed")

    if mode == "detached":
        asyncio.create_task(
            context.call_flow(
                operation_id="child:detached",
                slot="child",
                input={},
            )
        )
        await asyncio.sleep(0.05)
        return {"outcome": "done", "output": "must-not-succeed"}

    if mode == "error-with-detached":
        asyncio.create_task(
            context.call_flow(
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


serve(run)
