import asyncio

from jiggy.flow import OperationError, handle


async def run(context):
    channel = await context.channel()
    if context.input == "producer-close":
        await channel.send.send("prefix")
        await channel.send.close(error="LAGGED")
        try:
            await channel.receive.__anext__()
        except OperationError as error:
            if error.code != "LAGGED":
                raise
            await channel.receive.aclose()
            return {"outcome": "done", "output": {"complete": False, "cause": error.code}}
        raise ValueError("Producer failure became clean EOF")
    work = asyncio.create_task(context.call(
        operation_id="answer", slot="worker", input=context.input,
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
