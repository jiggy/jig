"""Independent host-peer direct channel exchange against both SDK processes."""

from pathlib import Path
import shutil
import sys
import unittest

from run0_peer import HostPeer, flow_run_request, success


ROOT = Path(__file__).resolve().parents[3]
COMPONENTS = ROOT / "conformance/run-0/components"


class DirectChannelPeerTests(unittest.TestCase):
    def exercise_producer_close(self, command):
        with HostPeer(command, environment={"PYTHONPATH": str(ROOT / "packages/jiggy-flow/src"), "PYTHONDONTWRITEBYTECODE": "1"}) as peer:
            peer.send(flow_run_request("root:1", "producer-close"))
            create = peer.receive_request("channel/create")
            peer.send(success(create["id"], {
                "send": {"endpoint": "writer:1", "direction": "send", "delivery": "direct"},
                "receive": {"endpoint": "reader:1", "direction": "receive", "delivery": "direct", "startSequence": 1},
            }))
            send = peer.receive_request("channel/send")
            peer.send(success(send["id"], None))
            close = peer.receive_request("channel/close")
            self.assertEqual(close["params"], {"endpoint": "writer:1", "error": "LAGGED"})
            peer.send(success(close["id"], None))
            read = peer.receive_request("channel/next")
            peer.send({"jsonrpc": "2.0", "id": read["id"], "error": {"code": -32000, "message": "producer incomplete", "data": {"code": "LAGGED"}}})
            release = peer.receive_request("channel/release")
            peer.send(success(release["id"], {"status": "failed", "code": "LAGGED"}))
            self.assertEqual(peer.receive()["result"], {"outcome": "done", "output": {"complete": False, "cause": "LAGGED"}})
            peer.finish()

    def test_producer_close_in_both_components(self):
        commands = [[sys.executable, str(COMPONENTS / "channels.py")]]
        if shutil.which("bun"):
            commands.append([shutil.which("bun"), str(COMPONENTS / "channels.ts")])
        for command in commands:
            with self.subTest(command=command):
                self.exercise_producer_close(command)

    def exercise(self, command, *, failed):
        with HostPeer(command, environment={
            "PYTHONPATH": str(ROOT / "packages/jiggy-flow/src"),
            "PYTHONDONTWRITEBYTECODE": "1",
        }) as peer:
            peer.send(flow_run_request("root:1", None))
            create = peer.receive_request("channel/create")
            peer.send(success(create["id"], {
                "send": {"endpoint": "writer:1", "direction": "send", "delivery": "direct"},
                "receive": {"endpoint": "reader:1", "direction": "receive", "delivery": "direct", "startSequence": 1},
            }))
            concurrent = [peer.receive(), peer.receive()]
            work = next(item for item in concurrent if item.get("method") == "flow/call")
            read = next(item for item in concurrent if item.get("method") == "channel/next")
            peer.validate_request(work, "flow/call")
            peer.validate_request(read, "channel/next")
            self.assertEqual(work["params"]["channels"], {"events": "writer:1"})
            peer.send(success(read["id"], {"item": {"sequence": 1, "value": {"sample": "room", "celsius": 21}}}))
            last = peer.receive_request("channel/next")
            if failed:
                peer.send({"jsonrpc": "2.0", "id": last["id"], "error": {
                    "code": -32000, "message": "observation capacity exceeded", "data": {"code": "LAGGED"},
                }})
            else:
                peer.send(success(last["id"], {"end": {"lastSequence": 1}}))
            peer.send(success(work["id"], {"outcome": "done", "output": "completed"}))
            self.assertEqual(peer.receive()["result"], {"outcome": "done", "output": {
                "complete": not failed, "values": [{"sample": "room", "celsius": 21}], "work": {"outcome": "done", "output": "completed"},
            }})
            peer.finish()

    def test_typescript_component(self):
        bun = shutil.which("bun")
        if bun is None:
            self.skipTest("bun is unavailable")
        for failed in (False, True):
            with self.subTest(failed=failed):
                self.exercise([bun, str(COMPONENTS / "channels.ts")], failed=failed)

    def test_python_component(self):
        for failed in (False, True):
            with self.subTest(failed=failed):
                self.exercise([sys.executable, str(COMPONENTS / "channels.py")], failed=failed)
