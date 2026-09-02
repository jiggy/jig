import asyncio

from flowmd_sdk import OperationError, handle


async def run(context):
    case = context.input.get("case")
    if case == "fanout-65":
        calls = [
            asyncio.create_task(
                context.call_effect(
                    operation_id=f"fanout:{index + 1}",
                    slot="sink",
                    method="write",
                    input={"index": index},
                )
            )
            for index in range(65)
        ]
        await asyncio.gather(*calls, return_exceptions=True)
        return {"outcome": "done", "output": {"settled": len(calls)}}

    if case == "operation-identity":
        async def call():
            return await context.call_effect(
                operation_id="shared:1",
                slot="sink",
                method="write",
                input={"value": "same"},
            )

        first_task = asyncio.create_task(call())
        second_task = asyncio.create_task(call())
        first, second = await asyncio.gather(first_task, second_task)
        replay = await call()
        conflict = None
        try:
            await context.call_effect(
                operation_id="shared:1",
                slot="sink",
                method="write",
                input={"value": "different"},
            )
        except OperationError as error:
            conflict = error.code
        return {
            "outcome": "done",
            "output": {
                "first": first,
                "second": second,
                "replay": replay,
                "conflict": conflict,
            },
        }

    if case == "cancel-shared-waiter":
        async def call_shared():
            return await context.call_effect(
                operation_id="shared-cancel:1",
                slot="sink",
                method="write",
                input={"value": "shared"},
            )

        cancelled = asyncio.create_task(call_shared())
        await asyncio.sleep(0)
        survivor = asyncio.create_task(call_shared())
        await asyncio.sleep(0)
        await context.call_effect(
            operation_id="release-shared-cancel:1",
            slot="control",
            method="release",
            input=None,
        )
        cancelled.cancel()
        cancellation = None
        try:
            await cancelled
        except asyncio.CancelledError:
            cancellation = "CANCELLED"
        return {
            "outcome": "done",
            "output": {
                "cancellation": cancellation,
                "survivor": await survivor,
            },
        }

    if case == "uncertain-replay":
        async def call_uncertain(operation_id):
            try:
                return await context.call_effect(
                    operation_id=operation_id,
                    slot="sink",
                    method="write",
                    input={"value": "uncertain"},
                )
            except OperationError as error:
                return error.code

        first = await call_uncertain("uncertain:1")
        replay = await call_uncertain("uncertain:1")
        fresh = await call_uncertain("uncertain:2")
        return {
            "outcome": "done",
            "output": {"first": first, "replay": replay, "fresh": fresh},
        }

    if case == "request-lifetime":
        accepted = 0
        rejected = None
        for index in range(1, 65_538):
            try:
                await context.call_effect(
                    operation_id=f"lifetime:{index}",
                    slot="sink",
                    method="write",
                    input=None,
                )
                accepted += 1
            except OperationError as error:
                rejected = error.code
        return {
            "outcome": "done",
            "output": {"accepted": accepted, "rejected": rejected},
        }

    if case == "one-flow":
        child = await context.call_flow(
            operation_id="child:1",
            slot="child",
            input=None,
        )
        return {"outcome": "done", "output": child}

    if case == "two-effects":
        first = await context.call_effect(
            operation_id="first:1",
            slot="sink",
            method="write",
            input={"sequence": 1},
        )
        second = await context.call_effect(
            operation_id="second:1",
            slot="sink",
            method="write",
            input={"sequence": 2},
        )
        return {"outcome": "done", "output": {"first": first, "second": second}}

    if case == "cancel-one-call":
        child = asyncio.create_task(
            context.call_flow(
                operation_id="cancelled-child:1",
                slot="child",
                input=None,
            )
        )
        await context.call_effect(
            operation_id="release-cancel:1",
            slot="control",
            method="release",
            input=None,
        )
        child.cancel()
        try:
            await child
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError("cancelled child unexpectedly completed")
        return {"outcome": "done", "output": "cancelled-locally"}

    if case == "abandoned-call":
        asyncio.create_task(
            context.call_flow(
                operation_id="abandoned-child:1",
                slot="child",
                input=None,
            )
        )
        await context.call_effect(
            operation_id="release-abandon:1",
            slot="control",
            method="release",
            input=None,
        )
        return {"outcome": "done", "output": "must-not-succeed"}

    return {"outcome": "done", "output": None}


handle(run)
