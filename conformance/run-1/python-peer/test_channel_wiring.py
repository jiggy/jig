"""Independent public-wire checks for endpoint forwarding and ordinary recovery."""

from pathlib import Path
import shutil
import sys
import unittest

from run1_peer import HostPeer, flow_run_request, success


ROOT = Path(__file__).resolve().parents[3]
IDENTITY = {"id": "https://example.org/contracts/updates", "version": "1.0.0",
            "digest": "sha256:" + "a" * 64}


def grant(endpoint, direction, *, named=True):
    result = {"endpoint": endpoint, "direction": direction, "delivery": "direct"}
    if direction == "receive":
        result["startSequence"] = 1
    if named:
        result["contract"] = IDENTITY
    return result


def error(request, code):
    return {"jsonrpc": "2.0", "id": request["id"], "error": {
        "code": -32000, "message": "scripted channel boundary failure", "data": {"code": code},
    }}


class ChannelWiringPeerTests(unittest.TestCase):
    def commands(self):
        yield [sys.executable, str(ROOT / "conformance/run-1/components/channel-wiring.py")]
        bun = shutil.which("bun")
        if bun is not None:
            yield [bun, str(ROOT / "conformance/run-1/components/channel-wiring.ts")]

    def peer(self, command):
        return HostPeer(command, environment={
            "PYTHONPATH": str(ROOT / "packages/jiggy-flow/src"),
            "PYTHONDONTWRITEBYTECODE": "1",
        })

    def start(self, peer, value, channels):
        request = flow_run_request("root:1", value)
        request["params"]["channels"] = channels
        peer.send(request)

    def test_parent_recovers_rejected_map_and_forwards_unchanged_rights(self):
        for command in self.commands():
            with self.subTest(component=command[-1]), self.peer(command) as peer:
                self.start(peer, {"role": "root"}, {"progress": grant("parent:output", "send", named=False)})
                create = peer.receive_request("channel/create")
                self.assertEqual(create["params"]["contract"], "./updates.json")
                peer.send(success(create["id"], {
                    "send": grant("parent:writer", "send"), "receive": grant("parent:reader", "receive"),
                }))
                rejected = peer.receive_request("flow/run-child")
                self.assertEqual(rejected["params"]["channels"], {"events": "parent:writer"})
                # Admission failure is scripted; the resolver is not under test.
                peer.send(error(rejected, "INVALID_INPUT"))
                calls = [peer.receive_request("flow/run-child"), peer.receive_request("flow/run-child")]
                worker = next(call for call in calls if call["params"]["slot"] == "worker")
                monitor = next(call for call in calls if call["params"]["slot"] == "monitor")
                self.assertEqual(worker["params"]["channels"], {"events": "parent:writer"})
                self.assertEqual(monitor["params"]["channels"], {
                    "events": "parent:reader", "progress": "parent:output",
                })
                watched = {"outcome": "done", "output": {"complete": False}}
                worked = {"outcome": "done", "output": {"answer": "Actual answer"}}
                peer.send(success(monitor["id"], watched))
                peer.send(success(worker["id"], worked))
                self.assertEqual(peer.receive()["result"], {"outcome": "done", "output": {
                    "incompatible": True, "work": worked, "monitor": watched,
                }})
                peer.finish()

    def test_worker_forwards_incoming_named_writer_to_capability(self):
        for command in self.commands():
            with self.subTest(component=command[-1]), self.peer(command) as peer:
                self.start(peer, {"role": "worker"}, {"events": grant("worker:writer", "send")})
                call = peer.receive_request("capability/call")
                self.assertEqual(call["params"]["channels"], {"events": "worker:writer"})
                peer.send(success(call["id"], {"value": {"answer": "Actual answer"}}))
                self.assertEqual(peer.receive()["result"], {"outcome": "done", "output": {"answer": "Actual answer"}})
                peer.finish()

    def test_monitor_filters_and_settles_early_or_failed_delivery(self):
        for command in self.commands():
            for mode in ("clean", "lagged", "stopped", "no-output"):
                with self.subTest(component=command[-1], mode=mode), self.peer(command) as peer:
                    channels = {"events": grant("monitor:reader", "receive")}
                    if mode != "no-output":
                        channels["progress"] = grant("monitor:output", "send", named=False)
                    self.start(peer, {"role": "monitor", "stop": mode == "stopped"}, channels)
                    selected = []
                    reads = releases = 0
                    result = None
                    for _ in range(10):
                        request = peer.receive()
                        if request.get("id") == "root:1":
                            result = request["result"]
                            break
                        method = request["method"]
                        peer.validate_request(request, method)
                        if method == "channel/next":
                            self.assertEqual(request["params"], {"endpoint": "monitor:reader"})
                            reads += 1
                            if reads <= 2:
                                value = {"stage": "planning"} if reads == 1 else {"text": "Selected text"}
                                peer.send(success(request["id"], {"item": {"sequence": reads, "value": value}}))
                            elif mode == "lagged":
                                peer.send(error(request, "LAGGED"))
                            else:
                                peer.send(success(request["id"], {"end": {"lastSequence": 2}}))
                        elif method == "channel/send":
                            self.assertEqual(request["params"], {"endpoint": "monitor:output", "value": "Selected text"})
                            selected.append(request["params"]["value"])
                            peer.send(success(request["id"], None))
                        elif method == "channel/release":
                            self.assertEqual(request["params"], {"endpoint": "monitor:reader"})
                            releases += 1
                            disposition = ({"status": "released"} if mode == "stopped" else
                                           {"status": "failed", "code": "LAGGED"} if mode == "lagged" else
                                           {"status": "ended", "lastSequence": 2})
                            peer.send(success(request["id"], disposition))
                        else:
                            self.assertEqual(method, "channel/close")
                            self.assertEqual(request["params"], {"endpoint": "monitor:output"})
                            peer.send(success(request["id"], None))
                    self.assertEqual(result, {"outcome": "done", "output": {
                        "complete": mode not in ("lagged", "stopped"), "selected": ["Selected text"],
                    }})
                    self.assertEqual(selected, [] if mode == "no-output" else ["Selected text"])
                    if mode in ("lagged", "stopped"):
                        self.assertEqual(releases, 1)
                    peer.finish()
