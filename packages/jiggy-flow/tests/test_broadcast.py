from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

from jiggy.flow import OperationError
from jiggy.flow._channels import validate_channel_result, validate_grant
from jiggy.flow._runtime import _Runtime, _SCHEMA_UNSET
from test_runtime import Component, _CapturedBuffer, root_request


def grant(endpoint, direction, start=1, contract=None):
    value = {"endpoint": endpoint, "direction": direction, "delivery": "broadcast"}
    if direction == "receive":
        value["startSequence"] = start
    if contract is not None:
        value["contract"] = contract
    return value


class BroadcastShapeTests(unittest.TestCase):
    def test_subscription_carries_actual_suffix_start(self):
        receive = grant("reader:late", "receive", 9)
        self.assertEqual(validate_grant(receive), receive)
        self.assertEqual(validate_channel_result("channel/subscribe", receive), receive)
        for changed in ({**receive, "delivery": "direct"}, {**receive, "startSequence": True},
                        {**receive, "startSequence": 0}, {**receive, "extra": None}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_channel_result("channel/subscribe", changed)

    def test_create_has_closed_delivery_specific_shape(self):
        valid = {"send": grant("writer:1", "send"), "source": "source:1"}
        self.assertEqual(validate_channel_result("channel/create", valid), valid)
        for changed in ({**valid, "receive": grant("reader:1", "receive")},
                        {**valid, "source": "x" * 129}, {**valid, "source": {}},
                        {"send": grant("writer:1", "send")},
                        {**valid, "send": grant("reader:1", "receive")},
                        {**valid, "send": {**valid["send"], "delivery": "direct"}}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_channel_result("channel/create", changed)


class BroadcastRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        async def handler(_context):
            return {"outcome": "done", "output": None}
        self.output = _CapturedBuffer()
        self.runtime = _Runtime(handler, self.output)
        self.runtime._root_id = "host:1"
        self.runtime._accepting_calls = True

    def frames(self):
        return list(map(json.loads, self.output.payloads))

    async def until(self, condition):
        async with asyncio.timeout(3):
            while not condition():
                await asyncio.sleep(0.001)

    async def request(self, coroutine):
        count = len(self.output.payloads)
        task = asyncio.create_task(coroutine)
        await self.until(lambda: len(self.output.payloads) > count)
        return task, self.frames()[count]

    async def answer(self, request, value=None, code=None):
        response = {"jsonrpc": "2.0", "id": request["id"]}
        if code is None:
            response["result"] = value
        else:
            response["error"] = {"code": -32000, "message": code, "data": {"code": code}}
        await self.runtime._handle_response(response)

    async def source(self, name="source:1", contract=None):
        task, request = await self.request(self.runtime.channel(
            delivery="broadcast", schema=_SCHEMA_UNSET,
            contract="./contract.json" if contract else None,
        ))
        self.assertEqual(request["params"]["delivery"], "broadcast")
        await self.answer(request, {"send": grant("writer:" + name, "send", contract=contract),
                                    "source": name})
        return await task

    async def subscribe(self, source, name, start=1):
        task, request = await self.request(source.subscribe())
        self.assertEqual(request["method"], "channel/subscribe")
        self.assertEqual(request["params"], {"source": source._reference})
        await self.answer(request, grant(name, "receive", start, source.send.contract))
        return await task

    async def dispose(self, receiver):
        task, request = await self.request(receiver.aclose())
        self.assertEqual(request["method"], "channel/release")
        await self.answer(request, {"status": "released"})
        await task

    async def test_subscription_authority_stays_with_creator_after_writer_offer(self):
        source = await self.source()
        params = {}
        self.runtime._map_channels(params, {"events": source.send})
        self.assertEqual(params, {"channels": {"events": "writer:source:1"}})
        feed = await self.subscribe(source, "reader:1", 4)
        self.assertEqual(feed.start_sequence, 4)
        self.assertEqual(feed.delivery, "broadcast")
        forwarded = {}
        self.runtime._map_channels(forwarded, {"input": feed})
        self.assertEqual(forwarded, {"channels": {"input": "reader:1"}})
        self.assertFalse(self.runtime._abandoned_receivers())

    async def test_source_is_not_a_transferable_endpoint(self):
        source = await self.source()
        before = len(self.output.payloads)
        with self.assertRaises(ValueError):
            self.runtime._map_channels({}, {"events": source})
        self.assertEqual(len(self.output.payloads), before)

    async def test_allocating_even_an_unread_subscription_is_active(self):
        source = await self.source()
        self.assertFalse(self.runtime._abandoned_receivers())
        feed = await self.subscribe(source, "reader:1")
        self.assertTrue(self.runtime._abandoned_receivers())
        await self.dispose(feed)
        self.assertFalse(self.runtime._abandoned_receivers())

    async def test_lagged_receiver_recovers_while_other_suffix_reaches_end(self):
        source = await self.source()
        early = await self.subscribe(source, "reader:early")
        late = await self.subscribe(source, "reader:late", 7)
        early_task, early_read = await self.request(anext(early))
        late_task, late_read = await self.request(anext(late))
        await self.answer(early_read, code="LAGGED")
        with self.assertRaises(OperationError) as failed:
            await early_task
        self.assertEqual(failed.exception.code, "LAGGED")
        await self.answer(late_read, {"item": {"sequence": 7, "value": {"reading": 21}}})
        self.assertEqual(await late_task, {"reading": 21})
        end_task, end = await self.request(anext(late))
        await self.answer(end, {"end": {"lastSequence": 7}})
        with self.assertRaises(StopAsyncIteration):
            await end_task
        self.assertFalse(self.runtime._abandoned_receivers())

    async def test_empty_suffix_ends_at_start_minus_one(self):
        feed = await self.subscribe(await self.source(), "reader:late", 8)
        task, request = await self.request(anext(feed))
        await self.answer(request, {"end": {"lastSequence": 7}})
        with self.assertRaises(StopAsyncIteration):
            await task
        await feed.aclose()
        self.assertEqual(len(self.frames()), 3)

    async def test_release_end_cannot_precede_subscription_start(self):
        feed = await self.subscribe(await self.source(), "reader:late", 8)
        task, request = await self.request(feed.aclose())
        await self.answer(request, {"status": "ended", "lastSequence": 6})
        with self.assertRaises(OperationError) as failed:
            await task
        self.assertEqual(failed.exception.code, "PROTOCOL_ERROR")
        self.assertTrue(self.runtime._fatal)

    async def test_release_end_cannot_precede_delivered_prefix(self):
        feed = await self.subscribe(await self.source(), "reader:1")
        reading, read = await self.request(anext(feed))
        await self.answer(read, {"item": {"sequence": 1, "value": "first"}})
        self.assertEqual(await reading, "first")
        closing, release = await self.request(feed.aclose())
        await self.answer(release, {"status": "ended", "lastSequence": 0})
        with self.assertRaises(OperationError) as failed:
            await closing
        self.assertEqual(failed.exception.code, "PROTOCOL_ERROR")
        self.assertTrue(self.runtime._fatal)

    async def test_release_end_cannot_precede_racing_committed_read(self):
        feed = await self.subscribe(await self.source(), "reader:1")
        reading, read = await self.request(anext(feed))
        closing = asyncio.create_task(feed.aclose())
        await self.until(lambda: self.frames()[-1].get("method") == "channel/release")
        release = self.frames()[-1]
        await self.answer(release, {"status": "ended", "lastSequence": 0})
        self.assertFalse(closing.done())
        await self.answer(read, {"item": {"sequence": 1, "value": "first"}})
        await asyncio.gather(reading, return_exceptions=True)
        with self.assertRaises(OperationError) as failed:
            await closing
        self.assertEqual(failed.exception.code, "PROTOCOL_ERROR")
        self.assertTrue(self.runtime._fatal)

    async def test_cancelled_create_closes_late_unexposed_writer(self):
        creating, request = await self.request(self.runtime.channel(
            delivery="broadcast", schema=_SCHEMA_UNSET, contract=None,
        ))
        creating.cancel()
        await asyncio.gather(creating, return_exceptions=True)
        self.assertEqual(self.frames()[-1]["method"], "request/cancel")
        await self.answer(request, {"send": grant("writer:1", "send"), "source": "source:1"})
        await self.until(lambda: self.frames()[-1]["method"] == "channel/close")
        close = self.frames()[-1]
        self.assertEqual(close["params"], {"endpoint": "writer:1"})
        self.assertTrue(self.runtime._settlements)
        await self.answer(close, None)
        await self.runtime._await_quiescence()
        await self.runtime._finish_channels()
        self.assertFalse(self.runtime._pending)
        self.assertFalse(self.runtime._settlements)

    async def test_cancelled_create_cleanup_error_prevents_success(self):
        creating, request = await self.request(self.runtime.channel(
            delivery="broadcast", schema=_SCHEMA_UNSET, contract=None,
        ))
        creating.cancel()
        await asyncio.gather(creating, return_exceptions=True)
        await self.answer(request, {"send": grant("writer:1", "send"), "source": "source:1"})
        await self.until(lambda: self.frames()[-1]["method"] == "channel/close")
        await self.answer(self.frames()[-1], code="UNAVAILABLE")
        await self.runtime._await_quiescence()
        with self.assertRaises(OperationError) as failed:
            await self.runtime._finish_channels()
        self.assertEqual(failed.exception.code, "UNCERTAIN")

    async def test_cancelled_subscription_releases_late_allocation(self):
        source = await self.source()
        subscribing, request = await self.request(source.subscribe())
        subscribing.cancel()
        await asyncio.gather(subscribing, return_exceptions=True)
        self.assertEqual(self.frames()[-1]["method"], "request/cancel")
        await self.answer(request, grant("reader:late", "receive", 5))
        await self.until(lambda: self.frames()[-1]["method"] == "channel/release")
        self.assertTrue(self.runtime._settlements)
        await self.answer(self.frames()[-1], {"status": "released"})
        await self.runtime._await_quiescence()
        await self.runtime._finish_channels()
        self.assertFalse(self.runtime._abandoned_receivers())

    async def test_cancelled_subscription_failed_status_confirms_disposal(self):
        source = await self.source()
        subscribing, request = await self.request(source.subscribe())
        subscribing.cancel()
        await asyncio.gather(subscribing, return_exceptions=True)
        await self.answer(request, grant("reader:late", "receive", 5))
        await self.until(lambda: self.frames()[-1]["method"] == "channel/release")
        await self.answer(self.frames()[-1], {"status": "failed", "code": "LAGGED"})
        await self.runtime._await_quiescence()
        await self.runtime._finish_channels()
        self.assertFalse(self.runtime._abandoned_receivers())
        self.assertTrue(self.runtime._endpoints["reader:late"]._released)

    async def test_cancelled_subscription_rejected_release_prevents_success(self):
        source = await self.source()
        subscribing, request = await self.request(source.subscribe())
        subscribing.cancel()
        await asyncio.gather(subscribing, return_exceptions=True)
        await self.answer(request, grant("reader:late", "receive", 5))
        await self.until(lambda: self.frames()[-1]["method"] == "channel/release")
        await self.answer(self.frames()[-1], code="UNAVAILABLE")
        await self.runtime._await_quiescence()
        with self.assertRaises(OperationError) as failed:
            await self.runtime._finish_channels()
        self.assertEqual(failed.exception.code, "UNCERTAIN")

    async def test_subscribe_failure_uses_ordinary_recovery(self):
        source = await self.source()
        subscribing, request = await self.request(source.subscribe())
        await self.answer(request, code="RESOURCE_EXHAUSTED")
        with self.assertRaises(OperationError) as failed:
            await subscribing
        self.assertEqual(failed.exception.code, "RESOURCE_EXHAUSTED")
        self.assertFalse(self.runtime._abandoned_receivers())
        await self.runtime._finish_channels()

    async def test_pending_subscriptions_reserve_late_release_request_ids(self):
        source = await self.source()
        with patch("jiggy.flow._runtime._REQUEST_ID_LIMIT", 6):
            first, first_request = await self.request(source.subscribe())
            second, second_request = await self.request(source.subscribe())
            with self.assertRaises(OperationError) as failed:
                await source.subscribe()
            self.assertEqual(failed.exception.code, "RESOURCE_EXHAUSTED")
            for task in (first, second):
                task.cancel()
            await asyncio.gather(first, second, return_exceptions=True)
            for index, request in enumerate((first_request, second_request)):
                await self.answer(request, grant(f"reader:{index}", "receive"))
            await self.until(lambda: sum(f.get("method") == "channel/release"
                                         for f in self.frames()) == 2)
            for request in self.frames():
                if request.get("method") == "channel/release":
                    await self.answer(request, {"status": "released"})
            await self.runtime._await_quiescence()
            self.assertEqual(len(self.runtime._component_ids), 5)


class BroadcastCompletionTests(unittest.TestCase):
    def test_cancelled_allocations_settle_before_root_success(self):
        for mode in ("broadcast-cancel-create", "broadcast-cancel-subscribe"):
            with self.subTest(mode=mode):
                component = Component()
                try:
                    component.send(root_request(mode))
                    create = component.receive()
                    created = {"send": grant("writer:1", "send"), "source": "source:1"}
                    allocation = create
                    if mode == "broadcast-cancel-subscribe":
                        component.send({"jsonrpc": "2.0", "id": create["id"], "result": created})
                        allocation = component.receive()
                        self.assertEqual(allocation["method"], "channel/subscribe")
                    cancel = component.receive()
                    self.assertEqual(cancel["method"], "request/cancel")
                    self.assertEqual(cancel["params"]["requestId"], allocation["id"])
                    self.assertFalse(component.has_output())
                    component.send({"jsonrpc": "2.0", "id": allocation["id"], "result":
                                     created if mode == "broadcast-cancel-create"
                                     else grant("reader:1", "receive", 4)})
                    cleanup = component.receive()
                    self.assertEqual(cleanup["method"], "channel/close"
                                     if mode == "broadcast-cancel-create" else "channel/release")
                    self.assertFalse(component.has_output())
                    component.send({"jsonrpc": "2.0", "id": cleanup["id"], "result":
                                     None if mode == "broadcast-cancel-create" else {"status": "released"}})
                    self.assertEqual(component.receive()["result"], {"outcome": "done", "output": "cancelled"})
                    component.wait()
                finally:
                    component.close()

    def test_unread_subscription_prevents_success(self):
        component = Component()
        try:
            component.send(root_request("broadcast-abandoned"))
            create = component.receive()
            component.send({"jsonrpc": "2.0", "id": create["id"], "result": {
                "send": grant("writer:1", "send"), "source": "source:1",
            }})
            subscribe = component.receive()
            component.send({"jsonrpc": "2.0", "id": subscribe["id"],
                             "result": grant("reader:1", "receive")})
            self.assertEqual(component.receive()["error"]["data"]["code"], "EXECUTION_FAILED")
            component.wait()
        finally:
            component.close()
