from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

from jiggy.flow import OperationError
from jiggy.flow._channels import validate_grant
from jiggy.flow._runtime import _Runtime, _SCHEMA_UNSET
from test_runtime import Component, _CapturedBuffer, root_request


def grant(endpoint: str, direction: str) -> dict[str, object]:
    value: dict[str, object] = {"endpoint": endpoint, "direction": direction, "delivery": "direct"}
    if direction == "receive":
        value["startSequence"] = 1
    return value


class ChannelGrantTests(unittest.TestCase):
    def test_canonical_contract_identity_matches_portable_grammar(self) -> None:
        for identity in ("https://example.org/channels/readings", "https://123.456/channel",
                         "https://example.org/" + "a" * 2049):
            value = {**grant("reader:1", "receive"), "contract": {
                "id": identity, "version": "1.0.0", "digest": "sha256:" + "a" * 64,
            }}
            self.assertEqual(validate_grant(value), value)
        for identity in ("https://127.0.0.1/channel", "https://example.org/../channel",
                         "https://example.org/channel/", "https://EXAMPLE.org/channel",
                         "https://example/channel"):
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                validate_grant({**grant("reader:1", "receive"), "contract": {
                    "id": identity, "version": "1.0.0", "digest": "sha256:" + "a" * 64,
                }})


class ChannelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.component = Component()

    def tearDown(self) -> None:
        self.component.close()

    def answer(self, request: dict, value: object) -> None:
        self.component.send({"jsonrpc": "2.0", "id": request["id"], "result": value})

    def fail_wire(self, request: dict, code: str) -> None:
        self.component.send({"jsonrpc": "2.0", "id": request["id"], "error": {
            "code": -32000, "message": code, "data": {"code": code},
        }})

    def create(self, mode: str) -> None:
        self.component.send(root_request(mode))
        create = self.component.receive()
        self.assertEqual(create["method"], "channel/create")
        self.answer(create, {"send": grant("writer:1", "send"), "receive": grant("reader:1", "receive")})

    def finish(self, output: object) -> None:
        self.assertEqual(self.component.receive()["result"]["output"], output)
        self.component.wait()

    def test_direct_messages_are_filtered_and_execution_is_separate(self) -> None:
        self.create("channels")
        first, second = self.component.receive(), self.component.receive()
        calls = {first["method"]: first, second["method"]: second}
        work, read = calls["capability/call"], calls["channel/next"]
        self.assertEqual(work["params"]["channels"], {"events": "writer:1"})
        self.answer(read, {"item": {"sequence": 1, "value": {"public": False, "text": "hidden"}}})
        read = self.component.receive()
        self.answer(read, {"item": {"sequence": 2, "value": {"public": True, "text": "visible"}}})
        read = self.component.receive()
        self.answer(read, {"end": {"lastSequence": 2}})
        self.assertFalse(self.component.has_output())
        self.answer(work, {"value": {"outcome": "completed"}})
        self.finish({"complete": True, "agent": {"outcome": "completed"}})
        self.assertEqual(self.component.remaining_stderr().decode().strip(), "visible")

    def test_channel_failure_is_recoverable_without_acknowledgement(self) -> None:
        self.create("channels")
        calls = [self.component.receive(), self.component.receive()]
        work = next(call for call in calls if call["method"] == "capability/call")
        read = next(call for call in calls if call["method"] == "channel/next")
        self.fail_wire(read, "LAGGED")
        release = self.component.receive()
        self.assertEqual(release["method"], "channel/release")
        self.answer(release, {"status": "failed", "code": "LAGGED"})
        self.answer(work, {"value": "completed"})
        self.finish({"complete": False, "agent": "completed"})

    def test_late_read_failure_is_exposed_by_disposal_once(self) -> None:
        self.create("channel-cancel-read")
        read = self.component.receive()
        cancel = self.component.receive()
        self.assertEqual(cancel["method"], "request/cancel")
        release = self.component.receive()
        self.assertEqual(release["method"], "channel/release")
        self.answer(release, {"status": "failed", "code": "LAGGED"})
        self.assertFalse(self.component.has_output())
        self.fail_wire(read, "LAGGED")
        self.finish("LAGGED")

    def test_cancelled_close_retains_disposal_and_late_failure(self) -> None:
        self.create("channel-cancel-close")
        read = self.component.receive()
        self.assertEqual(self.component.receive()["method"], "request/cancel")
        release = self.component.receive()
        # Keep settlement outstanding beyond the deliberate close cancellation.
        self.assertFalse(self.component.has_output(0.15))
        self.fail_wire(read, "LAGGED")
        self.answer(release, {"status": "failed", "code": "LAGGED"})
        self.finish("LAGGED")

    def test_disposal_winning_race_reports_intentional_incompleteness(self) -> None:
        self.create("channel-cancel-read")
        read = self.component.receive()
        self.assertEqual(self.component.receive()["method"], "request/cancel")
        release = self.component.receive()
        self.fail_wire(read, "CANCELLED")
        self.answer(release, {"status": "released"})
        self.finish("disposed")

    def test_cancelled_creation_retains_late_allocation_and_disposes_it(self) -> None:
        self.component.send(root_request("channel-cancel-create"))
        create = self.component.receive()
        self.assertEqual(self.component.receive()["method"], "request/cancel")
        self.answer(create, {"send": grant("writer:1", "send"), "receive": grant("reader:1", "receive")})
        release = self.component.receive()
        self.assertEqual(release["method"], "channel/release")
        self.answer(release, {"status": "released"})
        self.finish("cancelled")

    def test_unused_pair_is_disposed_but_active_receiver_is_abandonment(self) -> None:
        self.create("channel-unused")
        release = self.component.receive()
        self.assertEqual(release["method"], "channel/release")
        self.answer(release, {"status": "released"})
        self.finish("finished")

    def test_root_cancellation_during_implicit_disposal_prevents_success(self) -> None:
        self.create("channel-unused")
        release = self.component.receive()
        self.assertEqual(release["method"], "channel/release")
        self.component.send({"jsonrpc": "2.0", "method": "request/cancel",
                             "params": {"requestId": "host:1"}})
        self.assertFalse(self.component.has_output())
        self.answer(release, {"status": "released"})
        self.assertEqual(self.component.receive()["error"]["data"]["code"], "CANCELLED")
        self.component.wait()

    def test_active_unfinished_receiver_refuses_success(self) -> None:
        self.create("channel-abandoned")
        self.assertEqual(self.component.receive()["error"]["data"]["code"], "EXECUTION_FAILED")
        self.component.wait()

    def test_invalid_result_does_not_seal_writer(self) -> None:
        self.create("channel-bad-result")
        send = self.component.receive()
        self.assertEqual(send["method"], "channel/send")
        self.answer(send, None)
        self.assertEqual(self.component.receive()["error"]["data"]["code"], "INVALID_RESULT")
        self.component.wait()

    def test_inherited_grant_can_be_consumed(self) -> None:
        request = root_request("channel-inherited")
        request["params"]["channels"] = {"input": grant("input:1", "receive")}
        self.component.send(request)
        read = self.component.receive()
        self.answer(read, {"item": {"sequence": 1, "value": {"sample": "room", "celsius": 21}}})
        read = self.component.receive()
        self.answer(read, {"end": {"lastSequence": 1}})
        self.finish([{"sample": "room", "celsius": 21}])

    def test_noncontiguous_read_response_is_fatal(self) -> None:
        request = root_request("channel-inherited")
        request["params"]["channels"] = {"input": grant("input:1", "receive")}
        self.component.send(request)
        read = self.component.receive()
        self.answer(read, {"item": {"sequence": 2, "value": "skipped"}})
        self.component.wait(expected=1)
        self.assertNotIn(b'"result"', self.component.remaining_stdout())

    def test_unsupported_profile_fails_without_wire_dispatch(self) -> None:
        self.component.send(root_request("channel-unsupported"))
        self.finish("UNAVAILABLE")

    def test_channel_free_operational_failure_keeps_ordinary_recovery(self) -> None:
        self.component.send(root_request("channel-caught-child"))
        self.fail_wire(self.component.receive(), "EXECUTION_FAILED")
        self.finish("recovered")


class ChannelCapacityTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_send_remains_unsettled_until_wire_response(self) -> None:
        runtime, output = self.runtime()
        sender = runtime._register_endpoint(grant("writer:1", "send"))
        sending = asyncio.create_task(sender.send("pending"))
        await self.until(lambda: len(output.payloads) == 1)
        request = json.loads(output.payloads[0])
        sending.cancel()
        await asyncio.gather(sending, return_exceptions=True)
        with self.assertRaises(OperationError) as caught:
            await sender.close()
        self.assertEqual(caught.exception.code, "INVALID_INPUT")
        self.assertFalse(any(json.loads(payload).get("method") == "channel/close"
                             for payload in output.payloads))
        await self.answer(runtime, request, None)
        closing = asyncio.create_task(sender.close())
        await self.until(lambda: any(json.loads(payload).get("method") == "channel/close"
                                     for payload in output.payloads))
        await self.answer(runtime, json.loads(output.payloads[-1]), None)
        await closing

    def runtime(self) -> tuple[_Runtime, _CapturedBuffer]:
        async def handler(context):
            return {"outcome": "done", "output": None}
        output = _CapturedBuffer()
        runtime = _Runtime(handler, output)
        runtime._root_id = "host:1"
        runtime._accepting_calls = True
        return runtime, output

    async def until(self, predicate) -> None:
        async with asyncio.timeout(3):
            while not predicate():
                await asyncio.sleep(0.001)

    async def answer(self, runtime, request, value=None, code=None) -> None:
        response = {"jsonrpc": "2.0", "id": request["id"]}
        if code is None:
            response["result"] = value
        else:
            response["error"] = {"code": -32000, "message": code, "data": {"code": code}}
        await runtime._handle_response(response)

    async def test_saturated_ordinary_requests_leave_a_disposal_slot(self) -> None:
        runtime, output = self.runtime()
        receiver = runtime._register_endpoint(grant("reader:1", "receive"))
        calls = [asyncio.create_task(runtime.call_capability(
            operation_id=f"call:{index}", slot="service", method="run", input=None,
        )) for index in range(63)]
        await self.until(lambda: len(output.payloads) == 63)
        closing = asyncio.create_task(receiver.aclose())
        await self.until(lambda: len(output.payloads) == 64)
        release = json.loads(output.payloads[-1])
        self.assertEqual(release["method"], "channel/release")
        self.assertEqual(len(runtime._pending), 64)
        await self.answer(runtime, release, {"status": "released"})
        await closing
        for call in calls:
            call.cancel()
        await asyncio.gather(*calls, return_exceptions=True)
        for request in list(map(json.loads, output.payloads[:63])):
            await self.answer(runtime, request, code="CANCELLED")
        await runtime._await_quiescence()
        self.assertFalse(runtime._pending)

    async def test_pending_creates_reserve_lifetime_disposal_ids(self) -> None:
        runtime, output = self.runtime()
        with patch("jiggy.flow._runtime._REQUEST_ID_LIMIT", 6):
            creates = [asyncio.create_task(runtime.channel(
                delivery="direct", schema=_SCHEMA_UNSET, contract=None,
            )) for _ in range(2)]
            await self.until(lambda: len(output.payloads) == 2)
            with self.assertRaises(OperationError) as caught:
                await runtime.channel(delivery="direct", schema=_SCHEMA_UNSET, contract=None)
            self.assertEqual(caught.exception.code, "RESOURCE_EXHAUSTED")
            for creation in creates:
                creation.cancel()
            await asyncio.gather(*creates, return_exceptions=True)
            for index, request in enumerate(map(json.loads, output.payloads[:2])):
                await self.answer(runtime, request, {
                    "send": grant(f"writer:{index}", "send"),
                    "receive": grant(f"reader:{index}", "receive"),
                })
            answered = 2
            async with asyncio.timeout(3):
                while len(runtime._component_ids) < 4 or runtime._settlements:
                    frames = [json.loads(payload) for payload in output.payloads
                              if "id" in json.loads(payload)]
                    for request in frames[answered:]:
                        self.assertEqual(request["method"], "channel/release")
                        await self.answer(runtime, request, {"status": "released"})
                        answered += 1
                    await asyncio.sleep(0.001)
            self.assertEqual(len(runtime._component_ids), 4)
            await runtime._await_quiescence()

    async def test_schema_and_contract_are_exclusive_even_for_true(self) -> None:
        runtime, output = self.runtime()
        with self.assertRaises(ValueError):
            await runtime.channel(delivery="direct", schema=True, contract="./contract.json")
        self.assertEqual(output.payloads, [])

    async def test_local_read_admission_failure_does_not_end_receiver(self) -> None:
        runtime, output = self.runtime()
        receiver = runtime._register_endpoint(grant("reader:1", "receive"))
        with patch("jiggy.flow._runtime._REQUEST_ID_LIMIT", 1):
            with self.assertRaises(OperationError) as caught:
                await anext(receiver)
        self.assertEqual(caught.exception.code, "RESOURCE_EXHAUSTED")
        self.assertTrue(runtime._abandoned_receivers())
        self.assertIsNone(receiver._cause)
        closing = asyncio.create_task(receiver.aclose())
        await self.until(lambda: len(output.payloads) == 1)
        await self.answer(runtime, json.loads(output.payloads[0]), {"status": "released"})
        await closing
