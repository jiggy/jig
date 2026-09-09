import asyncio

from jiggy.flow import OperationError, handle


async def run(context):
    value = context.input
    if value["role"] == "root":
        source = await context.channel(contract="./updates.json")
        incompatible = False
        try:
            await context.run_child_flow(
                operation_id="incompatible", slot="incompatible", input=None,
                channels={"events": source.send},
            )
        except OperationError as error:
            if error.code != "INVALID_INPUT":
                raise
            incompatible = True
        channels = {"events": source.receive}
        if "progress" in context.channels:
            channels["progress"] = context.channels["progress"]
        work, monitor = await asyncio.gather(
            context.run_child_flow(operation_id="worker", slot="worker", input={"role": "worker"},
                                   channels={"events": source.send}),
            context.run_child_flow(operation_id="monitor", slot="monitor",
                                   input={"role": "monitor", "stop": value.get("stop", False)},
                                   channels=channels),
            return_exceptions=True,
        )
        if isinstance(work, BaseException):
            raise work
        if isinstance(monitor, BaseException):
            raise monitor
        return {"outcome": "done", "output": {"incompatible": incompatible, "work": work, "monitor": monitor}}
    if value["role"] == "worker":
        result = await context.call_capability(
            operation_id="answer", slot="agent", method="run", input=None,
            channels={"events": context.channels["events"]},
        )
        return {"outcome": "done", "output": result}
    if value["role"] != "monitor":
        raise TypeError("unknown role")
    events = context.channels["events"]
    progress = context.channels.get("progress")
    selected = []
    complete = True
    try:
        async with events:
            async for item in events:
                if not isinstance(item, dict) or "text" not in item:
                    continue
                selected.append(item["text"])
                if progress is not None:
                    await progress.send(item["text"])
                if value.get("stop", False):
                    complete = False
                    break
    except OperationError as error:
        if error.code != "LAGGED":
            raise
        complete = False
    if progress is not None:
        await progress.close()
    return {"outcome": "done", "output": {"complete": complete, "selected": selected}}


handle(run)
