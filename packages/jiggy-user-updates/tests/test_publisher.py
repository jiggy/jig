import asyncio
import pathlib
import os
import unittest
from types import SimpleNamespace

from jiggy.flow import OperationError
from jiggy.user_updates import USER_UPDATES_CONTRACT, user_updates, validate_user_update


class Sender:
    direction = "send"
    delivery = "direct"
    contract = dict(USER_UPDATES_CONTRACT)

    def __init__(self):
        self.values, self.closes = [], []

    async def send(self, value):
        self.values.append(value)

    async def close(self, *, error=None):
        self.closes.append(error)


class PublisherTests(unittest.IsolatedAsyncioTestCase):
    async def test_full_prompt_backlog_preserves_final_distinct_views(self):
        sender = Sender()
        async with user_updates(SimpleNamespace(channels={"updates": sender}), "updates") as updates:
            for n in range(12):
                updates.notice(f"Earlier {n}")
            updates.notice("Blocking cause retained independently", "error")
            for id in ("jobs", "checks", "patches"):
                updates.view(id, {"title": id}).update({"summary": f"{id} final evidence", "sections": []})
        self.assertEqual(len(sender.values), 16)
        self.assertEqual([value["text"] for value in sender.values[:12]], [f"Earlier {n}" for n in range(12)])
        self.assertEqual(sender.values[12]["severity"], "error")
        self.assertEqual([value["id"] for value in sender.values[13:]], ["jobs", "checks", "patches"])
        self.assertEqual(sender.closes, [None])

    async def test_cancellation_during_final_drain_keeps_original_send_owned(self):
        started, closed = asyncio.Event(), asyncio.Event()
        original = asyncio.get_running_loop().create_future()
        class Delayed(Sender):
            async def send(self, value):
                started.set()
                await original
            async def close(self, *, error=None):
                self.closes.append(error)
                closed.set()
        sender = Delayed()
        async def scope():
            async with user_updates(SimpleNamespace(channels={"updates": sender}), "updates") as updates:
                updates.notice("Final evidence")
        task = asyncio.create_task(scope())
        await started.wait()
        task.cancel()
        await closed.wait()
        self.assertFalse(task.done())
        self.assertFalse(original.cancelled())
        original.set_exception(OperationError("LAGGED"))
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(sender.closes, ["LAGGED"])

    async def test_snapshot_barriers_and_unwired_validation(self):
        sender = Sender()
        progress = {"completed": 0, "total": 1}
        async with user_updates(SimpleNamespace(channels={"updates": sender}), "updates") as updates:
            updates.activity("a", "old")
            updates.activity("a", "current", progress)
            progress["completed"] = 1
            updates.notice("barrier")
            await asyncio.sleep(0.23)
        self.assertEqual(sender.values, [
            {"kind": "activity", "id": "a", "label": "current", "progress": {"completed": 0, "total": 1}},
            {"kind": "notice", "text": "barrier"},
        ])
        self.assertEqual(sender.closes, [None])
        async with user_updates(SimpleNamespace(channels={}), "updates") as absent:
            with self.assertRaises(TypeError):
                absent.notice("")
        with self.assertRaises(RuntimeError):
            absent.clear("a")

    async def test_severity_validation_snapshot_and_unwired_offers(self):
        for severity in (None, 1, "fatal", {}):
            with self.assertRaises(TypeError):
                validate_user_update({"kind": "notice", "text": "problem", "severity": severity})
        for severity in ("info", "warning", "error"):
            source = {"kind": "notice", "text": "problem", "severity": severity}
            snapshot = validate_user_update(source)
            source["severity"] = "fatal"
            self.assertEqual(snapshot["severity"], severity)
        async with user_updates(SimpleNamespace(channels={}), "updates") as updates:
            with self.assertRaises(TypeError):
                updates.notice("problem", "fatal")
        sender = Sender()
        async with user_updates(SimpleNamespace(channels={"updates": sender}), "updates") as updates:
            updates.notice("problem", "error")
        self.assertEqual(sender.values, [{"kind": "notice", "text": "problem", "severity": "error"}])

    async def test_close_ack_before_delayed_unexpected_send_response(self):
        send = asyncio.get_running_loop().create_future()
        closed = asyncio.Event()
        class Delayed(Sender):
            async def send(self, value):
                await send
            async def close(self, *, error=None):
                self.closes.append(error)
                closed.set()
        sender = Delayed()
        async def scope():
            async with user_updates(SimpleNamespace(channels={"updates": sender}), "updates") as updates:
                updates.notice("one")
        task = asyncio.create_task(scope())
        await closed.wait()
        self.assertFalse(task.done())
        self.assertFalse(send.cancelled())
        failure = OperationError("RESOURCE_EXHAUSTED")
        send.set_exception(failure)
        with self.assertRaises(OperationError) as caught:
            await task
        self.assertIs(caught.exception, failure)
        self.assertEqual(sender.closes, ["LAGGED"])

    async def test_observer_loss_primary_failure_and_claim(self):
        class Lost(Sender):
            async def send(self, value):
                raise OperationError("DISCONNECTED")
        sender = Lost()
        async with user_updates(SimpleNamespace(channels={"updates": sender}), "updates") as updates:
            updates.notice("one")
        with self.assertRaises(RuntimeError):
            async with user_updates(SimpleNamespace(channels={"updates": sender}), "updates"):
                pass
        class Broken(Sender):
            async def send(self, value):
                raise OperationError("INVALID_INPUT")
        primary = ValueError("domain failure")
        with self.assertRaises(ValueError) as caught:
            async with user_updates(SimpleNamespace(channels={"updates": Broken()}), "updates") as updates:
                updates.notice("one")
                raise primary
        self.assertIs(caught.exception, primary)

    async def test_cancellation_joins_send_and_close_without_cancelling_send(self):
        started, closed = asyncio.Event(), asyncio.Event()
        send = asyncio.get_running_loop().create_future()
        class Delayed(Sender):
            async def send(self, value):
                started.set()
                await send
            async def close(self, *, error=None):
                self.closes.append(error)
                closed.set()
        sender = Delayed()
        async def scope():
            async with user_updates(SimpleNamespace(channels={"updates": sender}), "updates") as updates:
                updates.notice("one")
                await asyncio.Event().wait()
        task = asyncio.create_task(scope())
        await started.wait()
        task.cancel()
        await closed.wait()
        task.cancel()  # repeated cancellation cannot abandon owned cleanup
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        self.assertFalse(send.cancelled())
        send.set_exception(OperationError("LAGGED"))
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(sender.closes, ["LAGGED"])

    def test_semantics_and_descriptor_copy(self):
        self.assertEqual(validate_user_update({"kind": "activity", "id": "a", "label": "x", "progress": {"completed": 1.0}})["progress"]["completed"], 1)
        for value in [
            {"kind": "notice", "text": "\ud800"}, {"kind": "clear", "id": ""},
            {"kind": "notice", "text": "x", "extra": 1},
            {"kind": "activity", "id": "a", "label": "x\n"},
            {"kind": "activity", "id": "a", "label": "x", "progress": {"completed": True}},
            {"kind": "activity", "id": "a", "label": "x", "progress": {"completed": 1, "total": 0}},
        ]:
            with self.assertRaises(TypeError):
                validate_user_update(value)
        if not os.environ.get("USER_UPDATES_INSTALLED"):
            root = pathlib.Path(__file__).resolve().parents[2]
            self.assertEqual((root / "user-updates/src/user-updates.json").read_bytes(), (root / "jiggy-user-updates/src/jiggy/user_updates/user-updates.json").read_bytes())


if __name__ == "__main__":
    unittest.main()
