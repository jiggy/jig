#!/usr/bin/env python3

# DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
from flow_run import serve


async def ingest(run):
    record = await run.effects.call(
        operation_id="upsert-document",
        slot="index",
        method="upsert",
        input=run.input,
    )
    return {"outcome": "done", "output": record}


serve(ingest)
