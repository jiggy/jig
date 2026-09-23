from jiggy.flow import handle


async def run(context):
    import asyncio

    research_task = asyncio.create_task(
        context.call(
            operation_id="research:1",
            slot="research",
            intent="Find a useful comparison target.",
            input=context.input,
        )
    )
    stored_task = asyncio.create_task(
        context.call(
            operation_id="store:1",
            slot="artifact-write",
            input={"source": "research"},
        )
    )

    research, stored = await asyncio.gather(research_task, stored_task)
    missing = await context.call(
        operation_id="missing:1",
        slot="artifact-read",
        input={"uri": "artifact://missing"},
    )

    return {
        "outcome": "done",
        "output": {
            "research": research,
            "stored": stored,
            "missing": missing,
        },
    }


handle(run)
