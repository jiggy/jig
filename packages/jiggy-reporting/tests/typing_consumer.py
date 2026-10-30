from jiggy.flow import RunContext, RunResult
from jiggy.reporting import (DisplayPublicationContext, Progress, create_display_bundle, encode_display_bundle, reporting)


async def invoices(run: RunContext) -> RunResult:
    async with reporting(run, "updates") as updates:
        progress: Progress = {"completed": 2, "total": 3, "unit": "invoices"}
        updates.activity("batch", "Checking invoices", progress)
        updates.notice("A duplicate invoice needs review.", severity="warning")
        updates.clear("batch")
    return {"outcome": "needs-review", "output": {"duplicate": True}}


async def document_review(run: RunContext) -> RunResult:
    async with reporting(run, "updates") as updates:
        matters = updates.view("matters", {"title": "Document review", "landing": True})
        matters.update({"summary": "Check the supplied documents", "sections": [
            {"blocks": [{"kind": "report", "text": "Checking the requested questions"}]}]})
        matters.retire()
    return {"outcome": "needs-review", "output": None}


def final_edition(context: DisplayPublicationContext) -> str:
    bundle = create_display_bundle(context, {
        'requestId': 'publication-1', 'edition': 'Checked documents',
        'views': [{'view': {'kind':'view','id':'documents','title':'Documents',
            'summary':'Checked document material',
            'target': {'definitionId':'documents','instanceKey':'batch-1'},
            'sections': []}, 'completeness':'complete'}],
    })
    return encode_display_bundle(bundle)
