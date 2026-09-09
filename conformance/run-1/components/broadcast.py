"""Public Python broadcast composition; the host owns delivery and isolation."""

import asyncio

from jiggy.flow import ChannelReceiver, JsonValue, OperationError, RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    source = await context.channel(delivery="broadcast")
    early = await source.subscribe()
    await source.send.send("before-late")
    late = await source.subscribe()
    await source.send.send("after-late")
    await source.send.close()

    async def collect(receiver: ChannelReceiver) -> JsonValue:
        values: list[JsonValue] = []
        complete = True
        try:
            async for value in receiver:
                values.append(value)
        except OperationError as error:
            if error.code != "LAGGED":
                raise
            complete = False
        return {"start": receiver.start_sequence, "values": values, "complete": complete}

    first, second = await asyncio.gather(collect(early), collect(late), return_exceptions=True)
    if isinstance(first, BaseException):
        raise first
    if isinstance(second, BaseException):
        raise second
    return {"outcome": "done", "output": {"early": first, "late": second}}


handle(run)
