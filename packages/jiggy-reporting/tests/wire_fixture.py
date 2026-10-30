from jiggy.flow import ChannelReceiver, OperationError, RunContext, RunResult, handle
from typing import cast
from jiggy.reporting import reporting


async def run(context: RunContext) -> RunResult:
    try:
        async with reporting(context, "updates") as updates:
            mode = context.input.get('mode') if isinstance(context.input, dict) else None
            if mode == 'coalesce':
                views = [updates.view(identity, {'title':identity}) for identity in ('photos','organise','contact-sheet')]
                for revision in range(1000):
                    for view in views:
                        view.update({'summary':str(revision),'sections':[]})
                updates.notice('Edition boundary')
                views[0].update({'summary':'After boundary','sections':[]})
                views[0].retire()
            elif mode == 'traffic':
                view = updates.view('records', {'title':'Records'})
                receiver = cast(ChannelReceiver, context.channels['confirm'])
                rows = [{'id':str(index),'cells':{'text':'x'*420}} for index in range(1000)]
                for revision in range(11):
                    view.update({'summary':str(revision),'sections':[{'blocks':[{
                        'kind':'collection','id':'records','title':'Records',
                        'columns':[{'key':'text','label':'Text','type':'text'}],'rows':rows,
                    }]}]})
                    confirmation = await anext(receiver)
                    if not isinstance(confirmation, dict) or confirmation.get('text') != str(revision):
                        raise ValueError('Expected exact observed revision')
                await receiver.aclose()
            else:
                updates.notice("Validating invoice batch")
        return {"outcome": "checked", "output": {"invoices": 2}}
    except OperationError as error:
        return {"outcome": "publisher-failed", "output": error.code}


handle(run)
