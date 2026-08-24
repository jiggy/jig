import asyncio

from flowmd_sdk import serve


async def handle(run):
    if run.input.get("case") != "fanout-65":
        return {"outcome": "done", "output": None}

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


serve(handle)
