#!/usr/bin/env python3

# DESIGN PROBE ONLY: future Python projection of FLOW Run/1.
from flowmd_sdk import serve_run


async def wait_on_cordis(run):
    result = await run.effects.call(
        operation_id="wait-on-cordis",
        slot="delay",
        method="wait",
        input=run.input,
    )
    return {"outcome": "done", "output": result}


serve_run(wait_on_cordis)
