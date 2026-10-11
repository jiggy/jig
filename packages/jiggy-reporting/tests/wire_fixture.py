from jiggy.flow import OperationError, RunContext, RunResult, handle
from jiggy.reporting import reporting


async def run(context: RunContext) -> RunResult:
    try:
        async with reporting(context, "updates") as updates:
            updates.notice("Validating invoice batch")
        return {"outcome": "checked", "output": {"invoices": 2}}
    except OperationError as error:
        return {"outcome": "publisher-failed", "output": error.code}


handle(run)
