#!/usr/bin/env python3

# DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
from flowmd_sdk import serve_run


async def count_text(run):
    minimum = run.settings["minWordLength"]
    words = run.input["text"].split()
    count = sum(1 for word in words if len(word) >= minimum)

    return {
        "outcome": "done",
        "output": {"words": count},
    }


serve_run(count_text)
