import asyncio
from pathlib import Path
from jiggy.flow import handle, OperationError


async def run(context):
    value = context.input
    if value["role"] == "produce":
        (Path(context.attachments["files"]["path"]) / "candidate.txt").write_text(
            f'revision={value["revision"]}\n', encoding="utf-8")
        return {"outcome": "done", "output": {"revision": value["revision"]}}
    if value["role"] == "evaluate":
        text = (Path(context.attachments["candidate"]["path"]) / "candidate.txt").read_text(encoding="utf-8")
        return {"outcome": "done", "output": {"matches": text == f'revision={value["revision"]}\n'}}
    request = dict(operation_id="p1", slot="producer", input={"role": "produce", "revision": 1},
                   attachments={"files": {"create": True}})
    p1 = await context.call(**request)
    s1 = p1["artifacts"]["files"]
    p2 = await context.call(**{**request, "operation_id": "p2", "input": {"role": "produce", "revision": 2}})
    s2 = p2["artifacts"]["files"]
    readers = await asyncio.gather(*[
        context.call(operation_id=f"e{i}", slot="evaluator", input={"role": "evaluate", "revision": i},
                     attachments={"candidate": {"read": artifact}})
        for i, artifact in [(1, s1), (2, s2)]
    ])
    sibling = await context.call(operation_id="sibling", slot="evaluator",
                                 input={"role": "evaluate", "revision": 1},
                                 attachments={"candidate": {"read": s1}})
    duplicate = await context.call(**request)
    conflicts = 0
    try:
        await context.call(**{**request, "input": {"role": "produce", "revision": 9}})
    except OperationError as error:
        if error.code != "OPERATION_CONFLICT":
            raise
        conflicts += 1
    try:
        await context.call(operation_id="e1", slot="evaluator",
                           input={"role": "evaluate", "revision": 1},
                           attachments={"candidate": {"read": s2}})
    except OperationError as error:
        if error.code != "OPERATION_CONFLICT":
            raise
        conflicts += 1
    try:
        await context.call(operation_id="unknown-port", slot="evaluator", input=None,
                           attachments={"unknown": {"read": s1}})
    except OperationError as error:
        if error.code != "INVALID_INPUT":
            raise
        conflicts += 1
    initial = await context.call(operation_id="initial", slot="evaluator",
                                 input={"role": "evaluate", "revision": 0},
                                 attachments={"candidate": {"read": context.attachments["source"]["artifact"]}})
    await context.release(operation_id="release:1", artifact=s1)
    replay = await context.call(operation_id="e1", slot="evaluator",
                                 input={"role": "evaluate", "revision": 1},
                                 attachments={"candidate": {"read": s1}})
    if not replay["output"]["matches"]:
        raise RuntimeError("released exact replay changed")
    released = False
    try:
        await context.call(operation_id="released", slot="evaluator", input=None,
                           attachments={"candidate": {"read": s1}})
    except OperationError as error:
        if error.code != "PERMISSION_DENIED":
            raise
        released = True
    return {"outcome": "done", "output": {
        "matches": all(result["output"]["matches"] for result in [*readers, sibling, initial]),
        "duplicate": duplicate["artifacts"]["files"] is s1, "distinct": s1.reference != s2.reference,
        "conflicts": conflicts, "released": released,
    }, "artifactResults": {"final": s2}}


handle(run)
