from jiggy.flow import RunContext, RunResult
from jiggy.user_updates import Progress, user_updates


async def invoices(run: RunContext) -> RunResult:
    async with user_updates(run, "updates") as updates:
        progress: Progress = {"completed": 2, "total": 3, "unit": "invoices"}
        updates.activity("batch", "Checking invoices", progress)
        updates.notice("A duplicate invoice needs review.", severity="warning")
        updates.clear("batch")
    return {"outcome": "needs-review", "output": {"duplicate": True}}
