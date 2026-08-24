#!/usr/bin/env python3

# DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
from flowmd_sdk import serve_run


async def ingest(run):
    record = await run.effects.call(
        operation_id="upsert-document",
        slot="index",
        method="upsert",
        input=run.input,
    )
    return {"outcome": "done", "output": record}


serve_run(ingest)
