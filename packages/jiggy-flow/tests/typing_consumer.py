"""Type-check only against the installed public API."""
import asyncio
from typing import assert_type
from jiggy.flow import (
    Attachment, ChannelBroadcast, ChannelPair, ChannelReceiver, ChannelSender, JsonValue, OperationError,
    Artifact, CallResult, RunContext, RunHandler, RunResult, handle,
)

async def work(context: RunContext) -> RunResult:
    assert_type(context.input, JsonValue)
    assert_type(context.attachments["source"], Attachment)
    assert_type(context.deadline_unix_ms, int)
    pair = await context.channel()
    assert_type(pair, ChannelPair)
    assert_type(pair.send, ChannelSender)
    assert_type(pair.receive, ChannelReceiver)
    assert_type(pair.receive.start_sequence, int)
    await pair.receive.aclose()
    source = await context.channel(delivery="broadcast")
    assert_type(source, ChannelBroadcast)
    assert_type(source.send, ChannelSender)
    feed = await source.subscribe()
    assert_type(feed, ChannelReceiver)
    assert_type(feed.start_sequence, int)
    await feed.aclose()
    await source.send.close(error="LAGGED")
    try:
        child = await context.call(operation_id="child-1", slot="child", input=context.input)
        assert_type(child, CallResult)
        result = await context.call(operation_id="call-1", slot="service", input=None,
                                    intent="Read the selected record.", channels={})
        assert_type(result, CallResult)
        made = await context.call(operation_id="p1", slot="producer", input=None,
                                  attachments={"files": {"create": True}})
        artifact = made["artifacts"]["files"]
        assert_type(artifact, Artifact)
        await context.call(operation_id="e1", slot="reader", input=None,
                           attachments={"source": {"read": artifact}})
        await context.release(operation_id="r1", artifact=artifact)
        if result["outcome"] == "not-found":
            return {"outcome": "done", "output": None}
        return {"outcome": result["outcome"], "output": result["output"]}
    except OperationError as error:
        return {"outcome": "blocked", "output": error.code}
    except asyncio.CancelledError:
        raise

handler: RunHandler = work
handle(handler)
