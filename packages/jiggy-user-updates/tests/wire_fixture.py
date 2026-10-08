from jiggy.flow import OperationError, RunContext, RunResult, handle
from jiggy.user_updates import user_updates


async def run(context: RunContext) -> RunResult:
    try:
        async with user_updates(context, "updates") as updates:
            updates.notice("Validating invoice batch")
        return {"outcome": "checked", "output": {"invoices": 2}}
    except OperationError as error:
        return {"outcome": "publisher-failed", "output": error.code}


handle(run)
