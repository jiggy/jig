import asyncio

from flowmd_sdk import OperationError, serve


async def handle(run):
    case = run.input.get("case")
    if case == "fanout-65":
        calls = [
            asyncio.create_task(
                run.call_effect(
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
            return await run.call_effect(
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
            await run.call_effect(
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

    if case == "one-flow":
        child = await run.call_flow(
            operation_id="child:1",
            slot="child",
            input=None,
        )
        return {"outcome": "done", "output": child}

    if case == "two-effects":
        first = await run.call_effect(
            operation_id="first:1",
            slot="sink",
            method="write",
            input={"sequence": 1},
        )
        second = await run.call_effect(
            operation_id="second:1",
            slot="sink",
            method="write",
            input={"sequence": 2},
        )
        return {"outcome": "done", "output": {"first": first, "second": second}}

    if case == "cancel-one-call":
        child = asyncio.create_task(
            run.call_flow(
                operation_id="cancelled-child:1",
                slot="child",
                input=None,
            )
        )
        await run.call_effect(
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
            run.call_flow(
                operation_id="abandoned-child:1",
                slot="child",
                input=None,
            )
        )
        await run.call_effect(
            operation_id="release-abandon:1",
            slot="control",
            method="release",
            input=None,
        )
        return {"outcome": "done", "output": "must-not-succeed"}

    return {"outcome": "done", "output": None}


serve(handle)
