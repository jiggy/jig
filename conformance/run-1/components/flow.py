from jiggy.flow import CapabilityError, handle


async def run(context):
    import asyncio

    research_task = asyncio.create_task(
        context.run_child_flow(
            operation_id="research:1",
            slot="research",
            intent="Find a useful comparison target.",
            input=context.input,
        )
    )
    stored_task = asyncio.create_task(
        context.call_capability(
            operation_id="store:1",
            slot="artifacts",
            method="write",
            input={"source": "research"},
        )
    )

    research, stored = await asyncio.gather(research_task, stored_task)
    missing = None

    try:
        await context.call_capability(
            operation_id="missing:1",
            slot="artifacts",
            method="read",
            input={"uri": "artifact://missing"},
        )
    except CapabilityError as error:
        missing = error.error_name

    return {
        "outcome": "done",
        "output": {
            "research": research,
            "stored": stored,
            "missing": missing,
        },
    }


handle(run)
