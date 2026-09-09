"""Two real opposite-language SDK processes exchange actual structured values.

This finite witness scripts admitted grants. It does not import Jig's broker
or establish production identity enforcement, containment, or delivery policy.
"""

from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import shutil
import sys
import unittest

from run1_peer import HostPeer, flow_run_request, success


ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "conformance/run-1/fixtures/conversation.json").read_text())
ROLES = ("analysis", "dataset")
PORTS = ("requests", "replies")


def grant(role, port):
    descriptor = FIXTURE["contracts"][port]
    # ASCII strings and small integers only in these exact descriptors.
    # Sorted stdlib JSON is JCS-equivalent here, not a general JCS encoder.
    digest = hashlib.sha256(b"FLOW-Channel-Contract/1\0" + json.dumps(
        descriptor, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    ).encode()).hexdigest()
    direction = "send" if (role == "analysis") == (port == "requests") else "receive"
    value = {"endpoint": f"{role}:{port}", "direction": direction, "delivery": "direct",
             "contract": {"id": descriptor["id"], "version": descriptor["version"],
                          "digest": "sha256:" + digest}}
    if direction == "receive":
        value["startSequence"] = 1
    return value


class ConversationPeerTests(unittest.TestCase):
    def exercise(self, analysis_language, mode):
        bun = shutil.which("bun")
        if bun is None:
            self.skipTest("Bun is unavailable for the opposite-language peer")
        environment = {"PYTHONPATH": str(ROOT / "packages/jiggy-flow/src"),
                       "PYTHONDONTWRITEBYTECODE": "1"}
        languages = {"analysis": analysis_language,
                     "dataset": "py" if analysis_language == "ts" else "ts"}
        readings = [29 if mode == "shifted" and index == 4 else value
                    for index, value in enumerate(FIXTURE["samples"])]
        with ExitStack() as stack:
            peers = {role: stack.enter_context(HostPeer([
                bun if language == "ts" else sys.executable,
                str(ROOT / f"conformance/run-1/components/conversation.{language}"),
            ], environment=environment)) for role, language in languages.items()}
            pool = ThreadPoolExecutor(max_workers=2)
            streams = {port: {"count": 0, "queue": [], "closed": False, "ended": False,
                              "released": False, "pending": None} for port in PORTS}
            pending, terminals, transcript, closed = {}, {}, [], []
            held_reply = None
            cancelled = False

            def respond(item, value=None, code=None):
                role, request = item
                pending.pop((role, request["id"]), None)
                peers[role].send(success(request["id"], value) if code is None else {
                    "jsonrpc": "2.0", "id": request["id"],
                    "error": {"code": -32000, "message": code, "data": {"code": code}},
                })

            def deliver(stream):
                item = stream["pending"]
                if item is None:
                    return
                if stream["queue"]:
                    stream["pending"] = None
                    sequence = stream["count"] - len(stream["queue"]) + 1
                    respond(item, {"item": {"sequence": sequence, "value": stream["queue"].pop(0)}})
                elif stream["closed"]:
                    stream["pending"] = None
                    stream["ended"] = True
                    respond(item, {"end": {"lastSequence": stream["count"]}})

            def cancel_if_waiting():
                nonlocal held_reply, cancelled
                if mode != "cancel" or held_reply is None or streams["replies"]["pending"] is None or cancelled:
                    return
                cancelled = True
                for peer in peers.values():
                    peer.send({"jsonrpc": "2.0", "method": "request/cancel",
                               "params": {"requestId": "root:1"}})
                item = streams["replies"]["pending"]
                streams["replies"]["pending"] = None
                respond(item, code="CANCELLED")
                respond(held_reply, code="CANCELLED")
                held_reply = None

            try:
                for role, peer in peers.items():
                    samples = ([f"s{index}" for index in range(len(readings))]
                               if role == "analysis" else
                               [{"sample": f"s{index}", "celsius": celsius}
                                for index, celsius in enumerate(readings)])
                    root = flow_run_request("root:1", {"role": role, "mode": mode,
                                                     "samples": samples, "threshold": FIXTURE["threshold"]})
                    root["params"]["channels"] = {port: grant(role, port) for port in PORTS}
                    peer.send(root)
                futures = {pool.submit(peer.receive): role for role, peer in peers.items()}
                frames = 0
                while futures:
                    ready, _ = wait(futures, timeout=6, return_when=FIRST_COMPLETED)
                    self.assertTrue(ready, "finite conversation made no progress")
                    for future in ready:
                        role = futures.pop(future)
                        request = future.result()
                        frames += 1
                        self.assertLessEqual(frames, 96)
                        if request.get("id") == "root:1":
                            self.assertFalse(any(owner == role for owner, _ in pending))
                            terminals[role] = request
                            continue
                        if request.get("method") != "request/cancel":
                            peers[role].validate_request(request, request["method"])
                            item = role, request
                            pending[(role, request["id"])] = item
                            params = request["params"]
                            port = next((port for port in PORTS if params["endpoint"] == f"{role}:{port}"), None)
                            self.assertIsNotNone(port)
                            stream = streams[port]
                            method = request["method"]
                            if method == "channel/send":
                                self.assertEqual(grant(role, port)["direction"], "send")
                                if cancelled or stream["released"]:
                                    respond(item, code="CANCELLED" if cancelled else "DISCONNECTED")
                                elif mode == "cancel" and port == "replies":
                                    held_reply = item
                                    cancel_if_waiting()
                                else:
                                    self.assertFalse(stream["closed"])
                                    stream["count"] += 1
                                    self.assertLessEqual(stream["count"], 8)
                                    stream["queue"].append(params["value"])
                                    transcript.append((port, params["value"]))
                                    respond(item)
                                    deliver(stream)
                            elif method == "channel/next":
                                self.assertEqual(grant(role, port)["direction"], "receive")
                                if cancelled:
                                    respond(item, code="CANCELLED")
                                else:
                                    self.assertIsNone(stream["pending"])
                                    stream["pending"] = item
                                    deliver(stream)
                                    cancel_if_waiting()
                            elif method == "channel/close":
                                self.assertEqual(grant(role, port)["direction"], "send")
                                if not stream["closed"]:
                                    closed.append(port)
                                stream["closed"] = True
                                respond(item)
                                deliver(stream)
                            else:
                                self.assertEqual(method, "channel/release")
                                self.assertEqual(grant(role, port)["direction"], "receive")
                                stream["released"] = True
                                stream["queue"].clear()
                                if stream["pending"] is not None:
                                    respond(stream["pending"], code="CANCELLED")
                                    stream["pending"] = None
                                respond(item, {"status": "ended", "lastSequence": stream["count"]}
                                        if stream["ended"] else {"status": "released"})
                        futures[pool.submit(peers[role].receive)] = role
                self.assertFalse(pending)
                for peer in peers.values():
                    peer.finish()
            finally:
                # Close the finite process owners before joining any blocked
                # host reader when a test assertion itself fails.
                for peer in peers.values():
                    peer.dispose()
                pool.shutdown(wait=True, cancel_futures=True)
            if mode == "cancel":
                self.assertTrue(cancelled)
                for role in ROLES:
                    self.assertEqual(terminals[role]["error"]["data"]["code"], "CANCELLED")
            elif mode in ("clean", "shifted"):
                queries = ["s4", "s2", "s3"] if mode == "clean" else ["s4", "s6", "s5"]
                self.assertEqual(closed, ["requests", "replies"])
                self.assertEqual([value["sample"] for port, value in transcript if port == "requests"], queries)
                self.assertEqual([port for port, _ in transcript], ["requests", "replies"] * 3)
                self.assertEqual(terminals["analysis"]["result"], {"outcome": "done", "output": {
                    "threshold": 30,
                    "crossing": ({"sample": "s4", "index": 4, "celsius": 31} if mode == "clean" else
                                 {"sample": "s5", "index": 5, "celsius": 37}),
                    "observations": [{"sample": "s4", "celsius": 31}, {"sample": "s2", "celsius": 23},
                                     {"sample": "s3", "celsius": 26}] if mode == "clean" else
                                    [{"sample": "s4", "celsius": 29}, {"sample": "s6", "celsius": 44},
                                     {"sample": "s5", "celsius": 37}],
                }})
                self.assertEqual(terminals["dataset"]["result"], {"outcome": "done", "output": {"served": queries}})
            else:
                self.assertEqual(terminals["analysis"]["error"]["data"]["code"], "EXECUTION_FAILED")
                self.assertIn("result", terminals["dataset"])
                self.assertCountEqual(closed, PORTS)

    def test_typescript_analysis_python_dataset(self):
        for mode in ("clean", "shifted", "duplicate", "unexpected", "early-eof", "cancel"):
            with self.subTest(mode=mode):
                self.exercise("ts", mode)

    def test_python_analysis_typescript_dataset(self):
        for mode in ("clean", "shifted", "duplicate", "unexpected", "early-eof", "cancel"):
            with self.subTest(mode=mode):
                self.exercise("py", mode)
