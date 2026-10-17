import asyncio
import json
import unittest
from dataclasses import FrozenInstanceError

from jiggy.flow import OperationError
from jiggy.flow._artifacts import _Artifacts, _Artifact
from jiggy.flow._json import normalize_json1
from jiggy.flow._runtime import _Runtime, _validate_run_wire_result, _validate_flow_run_params
from test_runtime import _CapturedBuffer, root_request


class ArtifactShapeTests(unittest.TestCase):
    def test_genuine_objects_have_no_path_and_do_not_grant_another_run_rights(self):
        owner = _Artifacts()
        held = owner.grant("artifact:1")
        self.assertIs(owner.grant("artifact:1"), held)
        self.assertFalse(hasattr(held, "path"))
        with self.assertRaises(FrozenInstanceError):
            held.reference = "fake:1"
        for forged in ({"reference": held.reference}, _Artifact(held.reference)):
            with self.assertRaises(ValueError):
                owner.reference(forged)
        with self.assertRaises(ValueError):
            _Artifacts().reference(held)
        with self.assertRaises(ValueError):
            normalize_json1(held)
        owner.retire(held.reference)
        self.assertIs(owner.grant(held.reference), held)
        with self.assertRaises(ValueError):
            owner.reference(held)
        self.assertEqual(owner.reference(held, allow_released=True), "artifact:1")

    def test_wire_maps_token_bounds_and_wrong_direction_are_strict(self):
        for refs in (None, [], {"files": ""}, {"files": "x" * 129},
                     {"files": "a\n"}, {"bad\n": "a:1"}, {"files": {"reference": "a:1"}}):
            with self.subTest(refs=refs), self.assertRaises(ValueError):
                _validate_run_wire_result({"outcome": "done", "output": None, "artifacts": refs})
        with self.assertRaises(ValueError):
            _validate_run_wire_result({"outcome": "done", "output": None, "artifactResults": {}})
        params = root_request("test")["params"]
        params["attachments"] = {"files": {"path": "/out", "access": "read-write", "artifact": "a:1"}}
        with self.assertRaises(ValueError):
            _validate_flow_run_params(params)


class ArtifactRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        async def handler(_):
            return {"outcome": "done", "output": None}
        self.output = _CapturedBuffer()
        self.runtime = _Runtime(handler, self.output)
        self.runtime._root_id = "host:1"
        self.runtime._accepting_calls = True

    async def request(self, coroutine):
        count = len(self.output.payloads)
        task = asyncio.create_task(coroutine)
        async with asyncio.timeout(3):
            while len(self.output.payloads) <= count:
                await asyncio.sleep(0.001)
        return task, json.loads(self.output.payloads[count])

    async def answer(self, request, result):
        await self.runtime._handle_response({"jsonrpc": "2.0", "id": request["id"], "result": result})

    async def test_call_projection_identity_and_early_release_retains_cancelled_settlement(self):
        task, call = await self.request(self.runtime.call(
            operation_id="p1", slot="producer", input=None, attachments={"files": {"create": True}}))
        self.assertEqual(call["params"]["attachments"], {"files": {"create": True}})
        await self.answer(call, {"outcome": "done", "output": None, "artifacts": {"files": "a:1"}})
        held = (await task)["artifacts"]["files"]
        releasing, release = await self.request(self.runtime.release(operation_id="release:1", artifact=held))
        releasing.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await releasing
        self.assertTrue(self.runtime._pending)
        await self.answer(release, {})
        with self.assertRaises(ValueError):
            self.runtime._artifacts.reference(held)
        # A ref can still serialize for exact duplicate replay; the host decides
        # whether it replays or starts a new read and validates current rights.
        replay, request = await self.request(self.runtime.call(
            operation_id="e1", slot="reader", input=None, attachments={"source": {"read": held}}))
        self.assertEqual(request["params"]["attachments"], {"source": {"read": "a:1"}})
        await self.answer(request, {"outcome": "done", "output": None, "artifacts": {"files": "a:1"}})
        self.assertIs((await replay)["artifacts"]["files"], held)
        with self.assertRaises(ValueError):
            self.runtime._artifacts.reference(held)

    async def test_rejects_malformed_or_forged_maps_before_dispatch(self):
        for attachments in ({"files": {"create": 1}}, {"files": {"create": False}},
                            {"files": {"read": {"reference": "a:1"}}},
                            {"files": {"create": True, "path": "/host"}},
                            {"bad\n": {"create": True}}):
            with self.subTest(attachments=attachments), self.assertRaises(ValueError):
                await self.runtime.call(operation_id="p1", slot="producer", input=None, attachments=attachments)
        self.assertEqual(self.output.payloads, [])

    async def test_optional_unsupported_release_is_recoverable(self):
        held = self.runtime._artifacts.grant("a:1")
        task, request = await self.request(self.runtime.release(operation_id="r1", artifact=held))
        await self.runtime._handle_response({"jsonrpc": "2.0", "id": request["id"],
                                            "error": {"code": -32601, "message": "Method not found"}})
        with self.assertRaises(OperationError) as failure:
            await task
        self.assertEqual(failure.exception.code, "UNAVAILABLE")
        self.assertFalse(self.runtime._fatal)
