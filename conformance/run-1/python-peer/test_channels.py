"""Independent host-peer direct channel exchange against both SDK processes."""

from pathlib import Path
import shutil
import sys
import unittest

from run1_peer import HostPeer, flow_run_request, success


ROOT = Path(__file__).resolve().parents[3]
COMPONENTS = ROOT / "conformance/run-1/components"


class DirectChannelPeerTests(unittest.TestCase):
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
            work = next(item for item in concurrent if item.get("method") == "capability/call")
            read = next(item for item in concurrent if item.get("method") == "channel/next")
            peer.validate_request(work, "capability/call")
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
            peer.send(success(work["id"], {"value": "completed"}))
            self.assertEqual(peer.receive()["result"], {"outcome": "done", "output": {
                "complete": not failed, "values": [{"sample": "room", "celsius": 21}], "work": "completed",
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
