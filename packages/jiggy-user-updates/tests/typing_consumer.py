from jiggy.flow import RunContext, RunResult
from jiggy.user_updates import Progress, user_updates


async def invoices(run: RunContext) -> RunResult:
    async with user_updates(run, "updates") as updates:
        progress: Progress = {"completed": 2, "total": 3, "unit": "invoices"}
        updates.activity("batch", "Checking invoices", progress)
        updates.notice("A duplicate invoice needs review.", severity="warning")
        updates.clear("batch")
    return {"outcome": "needs-review", "output": {"duplicate": True}}


async def document_review(run: RunContext) -> RunResult:
    async with user_updates(run, "updates") as updates:
        matters = updates.view("matters", {"title": "Document review", "landing": True})
        matters.update({"summary": "Check the supplied documents", "sections": [
            {"blocks": [{"kind": "report", "text": "Checking the requested questions"}]}]})
        matters.retire()
    return {"outcome": "needs-review", "output": None}
