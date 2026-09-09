"""Independent host-peer broadcast traces against public SDK processes.

Scripted suffix and lag responses verify wire/SDK behavior, not a host broker's
queue isolation or authority enforcement.
"""

from pathlib import Path
import shutil
import sys
import unittest

from run1_peer import HostPeer, flow_run_request, success


ROOT = Path(__file__).resolve().parents[3]
COMPONENTS = ROOT / "conformance/run-1/components"


def grant(endpoint, direction, start=1):
    value = {"endpoint": endpoint, "direction": direction, "delivery": "broadcast"}
    if direction == "receive":
        value["startSequence"] = start
    return value


class BroadcastPeerTests(unittest.TestCase):
    def exercise(self, command, *, lagged):
        with HostPeer(command, environment={
            "PYTHONPATH": str(ROOT / "packages/jiggy-flow/src"),
            "PYTHONDONTWRITEBYTECODE": "1",
        }) as peer:
            peer.send(flow_run_request("root:1", None))
            create = peer.receive_request("channel/create")
            self.assertEqual(create["params"]["delivery"], "broadcast")
            peer.send(success(create["id"], {"send": grant("writer:1", "send"), "source": "source:1"}))
            early = peer.receive_request("channel/subscribe")
            self.assertEqual(early["params"], {"source": "source:1"})
            peer.send(success(early["id"], grant("reader:early", "receive")))
            first = peer.receive_request("channel/send")
            self.assertEqual(first["params"], {"endpoint": "writer:1", "value": "before-late"})
            peer.send(success(first["id"], None))
            late = peer.receive_request("channel/subscribe")
            self.assertEqual(late["params"], {"source": "source:1"})
            peer.send(success(late["id"], grant("reader:late", "receive", 2)))
            second = peer.receive_request("channel/send")
            self.assertEqual(second["params"], {"endpoint": "writer:1", "value": "after-late"})
            peer.send(success(second["id"], None))
            close = peer.receive_request("channel/close")
            self.assertEqual(close["params"], {"endpoint": "writer:1"})
            peer.send(success(close["id"], None))
            delivered = {"reader:early": 0, "reader:late": 1}
            terminal = set()
            while len(terminal) != 2:
                request = peer.receive_request("channel/next")
                endpoint = request["params"]["endpoint"]
                self.assertNotIn(endpoint, terminal)
                if lagged and endpoint == "reader:early":
                    peer.send({"jsonrpc": "2.0", "id": request["id"], "error": {
                        "code": -32000, "message": "subscriber capacity exceeded",
                        "data": {"code": "LAGGED"},
                    }})
                    terminal.add(endpoint)
                elif delivered[endpoint] < 2:
                    delivered[endpoint] += 1
                    sequence = delivered[endpoint]
                    peer.send(success(request["id"], {"item": {
                        "sequence": sequence,
                        "value": "before-late" if sequence == 1 else "after-late",
                    }}))
                else:
                    peer.send(success(request["id"], {"end": {"lastSequence": 2}}))
                    terminal.add(endpoint)
            self.assertEqual(peer.receive()["result"], {"outcome": "done", "output": {
                "early": {"start": 1, "values": [] if lagged else ["before-late", "after-late"],
                          "complete": not lagged},
                "late": {"start": 2, "values": ["after-late"], "complete": True},
            }})
            peer.finish()

    def test_python_component(self):
        for lagged in (False, True):
            with self.subTest(lagged=lagged):
                self.exercise([sys.executable, str(COMPONENTS / "broadcast.py")], lagged=lagged)

    def test_typescript_component(self):
        bun = shutil.which("bun")
        if bun is None:
            self.skipTest("bun is unavailable")
        for lagged in (False, True):
            with self.subTest(lagged=lagged):
                self.exercise([bun, str(COMPONENTS / "broadcast.ts")], lagged=lagged)
