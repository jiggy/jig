import asyncio

from jiggy.flow import OperationError, handle


async def run(context):
    channel = await context.channel()
    work = asyncio.create_task(context.call_capability(
        operation_id="answer", slot="worker", method="run", input=context.input,
        channels={"events": channel.send},
    ))
    values = []
    complete = True
    try:
        async for value in channel.receive:
            values.append(value)
    except OperationError as error:
        if error.code != "LAGGED":
            await asyncio.gather(work, return_exceptions=True)
            raise
        complete = False
    return {"outcome": "done", "output": {"complete": complete, "values": values, "work": await work}}


handle(run)
