#!/usr/bin/env python3

# DESIGN PROBE ONLY: hypothetical FLOW Run SDK.
from flow_run import serve


async def schedule_reminder(run):
    record = await run.effects.call(
        operation_id="schedule-reminder",
        slot="scheduler",
        method="schedule",
        input=run.input,
    )
    return {"outcome": "done", "output": record}


serve(schedule_reminder)

