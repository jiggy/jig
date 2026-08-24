#!/usr/bin/env python3

# DESIGN PROBE ONLY: future Python projection of FLOW Run/1.
from flowmd_sdk import serve_run


async def reverse_text(run):
    return {
        "outcome": "done",
        "output": {"value": "".join(reversed(run.input["text"]))},
    }


serve_run(reverse_text)
