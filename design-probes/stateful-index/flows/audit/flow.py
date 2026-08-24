#!/usr/bin/env python3

# DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
from flowmd_sdk import CapabilityError, serve_run


async def audit(run):
    event = run.input
    document_id = event["data"]["documentId"]
    expected_revision = event["data"]["revision"]

    stats = await run.effects.call(
        operation_id="read-index-stats",
        slot="index",
        method="stats",
        input={},
    )

    try:
        record = await run.effects.call(
            operation_id="read-indexed-document",
            slot="index",
            method="get",
            input={"documentId": document_id},
        )
    except CapabilityError as error:
        if error.name != "not-found":
            raise
        return {
            "outcome": "stale",
            "output": {
                "documentId": document_id,
                "expectedRevision": expected_revision,
                "visibleRevision": 0,
                "documents": stats["documents"],
                "pendingEvents": stats["pendingEvents"],
            },
        }

    visible_revision = record["revision"]
    outcome = "done" if visible_revision >= expected_revision else "stale"
    return {
        "outcome": outcome,
        "output": {
            "documentId": document_id,
            "expectedRevision": expected_revision,
            "visibleRevision": visible_revision,
            "documents": stats["documents"],
            "pendingEvents": stats["pendingEvents"],
        },
    }


serve_run(audit)
