#!/usr/bin/env python3

# DESIGN PROBE ONLY: hypothetical FLOW Run SDK.
from flow_run import serve


async def record_firing(run):
    event = run.input
    return {
        "outcome": "done",
        "output": {
            "eventId": event["eventId"],
            "timerId": event["data"]["timerId"],
            "payload": event["data"]["payload"],
        },
    }


serve(record_firing)

