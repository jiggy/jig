"""Deterministic non-Jig host: real SDK processes and immutable finite trees.

The host uses only stdlib and the independent public-wire peer. This is portable
boundary evidence, not containment, native execution qualification or a clean-room
consumer study. Its fixed routing is fixture policy, not a FLOW requirement.
"""
from copy import deepcopy
from pathlib import Path
import json
import shutil
import sys
import tempfile
import unittest

from run0_peer import HostPeer, ProtocolError, flow_run_request, success, require_wire_id, validate_artifact_value

ROOT = Path(__file__).resolve().parents[3]


class Refusal(Exception):
    pass


class ArtifactHost:
    def __init__(self, directory, command):
        self.directory = Path(directory)
        self.command = command
        self.rights = {"root": set()}
        self.trees = {}
        self.operations = {}
        self.allocations = 0
        self.launches = 0
        self.outputs = set()

    def grant(self, owner, tree):
        ref = f"artifact:{len(self.trees) + 1}"
        self.trees[ref] = tree
        self.rights.setdefault(owner, set()).add(ref)
        return ref

    def borrow(self, owner, reference):
        require_wire_id(reference)
        if reference not in self.rights.get(owner, set()):
            raise Refusal("PERMISSION_DENIED")
        return self.trees[reference]

    def release(self, owner, reference):
        self.borrow(owner, reference)
        self.rights[owner].remove(reference)

    def operation(self, owner, method, params):
        operation_id = require_wire_id(params["operationId"])
        key = (owner, operation_id)
        meaning = json.dumps([method, {k: v for k, v in params.items() if k != "operationId"}],
                             sort_keys=True, separators=(",", ":"))
        if key in self.operations:
            original, result = self.operations[key]
            if original != meaning:
                raise Refusal("OPERATION_CONFLICT")
            return deepcopy(result)
        if method == "flow/artifact/release":
            if set(params) != {"operationId", "artifact"}:
                raise Refusal("INVALID_INPUT")
            self.release(owner, params["artifact"])
            result = {}
        else:
            result = self.call(owner, params)
        self.operations[key] = (meaning, deepcopy(result))
        return result

    def call(self, owner, params):
        if set(params) - {"operationId", "slot", "input", "attachments"}:
            raise Refusal("INVALID_INPUT")
        slot = params["slot"]
        expected = {"files": {"create": True}} if slot == "producer" else None
        supplied = params.get("attachments")
        if slot == "producer":
            if supplied != expected:
                raise Refusal("INVALID_INPUT")
            self.allocations += 1
            path = self.directory / f"output-{self.allocations}"
            path.mkdir()
            self.outputs.add(path)
            attachments = {"files": {"path": str(path), "access": "read-write"}}
        elif slot == "evaluator":
            if not isinstance(supplied, dict) or set(supplied) != {"candidate"}:
                raise Refusal("INVALID_INPUT")
            item = supplied["candidate"]
            if not isinstance(item, dict) or set(item) != {"read"}:
                raise Refusal("INVALID_INPUT")
            path = self.borrow(owner, item["read"])
            # The child holds a distinct invocation right, not its parent's token.
            child = f"child:{self.launches + 1}"
            reference = self.grant(child, path)
            attachments = {"candidate": {"path": str(path), "access": "read", "artifact": reference}}
        else:
            raise Refusal("INVALID_INPUT")
        self.launches += 1
        child = f"child:{self.launches}"
        result = self.invoke(child, params["input"], attachments)
        if slot == "producer":
            # Fencing/cleanup is confirmed by peer.finish before grant publication.
            for file in path.iterdir():
                file.chmod(0o444)
            path.chmod(0o555)
            result["artifacts"] = {"files": self.grant(owner, path)}
        return result

    def invoke(self, owner, value, attachments):
        with HostPeer(self.command, environment={
            "PYTHONPATH": str(ROOT / "packages/jiggy-flow/src"),
            "PYTHONDONTWRITEBYTECODE": "1",
        }) as peer:
            request = flow_run_request("root:1", value)
            request["params"]["attachments"] = attachments
            peer.send(request)
            for _ in range(32):
                message = peer.receive()
                if message.get("id") == "root:1":
                    result = message["result"]
                    if set(result) - {"outcome", "output", "artifactResults"}:
                        raise AssertionError("component manufactured a host envelope")
                    domain = {"outcome": result["outcome"], "output": result["output"]}
                    selected = result.get("artifactResults", {})
                    if set(selected) - ({"final"} if owner == "root" else set()):
                        raise Refusal("INVALID_RESULT")
                    retained = {name: self.borrow(owner, ref) for name, ref in selected.items()}
                    peer.finish()
                    self.rights.pop(owner, None)  # automatic finite cleanup
                    if owner == "root":
                        for path in self.outputs - set(retained.values()):
                            path.chmod(0o755)
                            shutil.rmtree(path)
                        self.trees = {ref: path for ref, path in self.trees.items()
                                      if path not in self.outputs or path in retained.values()}
                    return {**domain, **({"artifacts": retained} if retained else {})}
                peer.validate_request(message, message["method"])
                try:
                    result = self.operation(owner, message["method"], message["params"])
                    peer.send(success(message["id"], result))
                except Refusal as error:
                    peer.send({"jsonrpc": "2.0", "id": message["id"], "error": {
                        "code": -32000, "message": "fixture authority refusal", "data": {"code": str(error)},
                    }})
            raise AssertionError("unbounded component exchange")


class ArtifactPeerTests(unittest.TestCase):
    def test_shared_artifact_wire_shapes_and_bounds(self):
        fixtures = json.loads((ROOT / "conformance/run-0/fixtures/artifacts.json").read_text())
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                if fixture["valid"]:
                    validate_artifact_value(fixture["definition"], fixture["value"])
                else:
                    with self.assertRaises(ProtocolError):
                        validate_artifact_value(fixture["definition"], fixture["value"])
        for definition, item in [("artifactReferences", "a:1"), ("callAttachments", {"create": True})]:
            value = {f"port-{i}": item for i in range(256)}
            validate_artifact_value(definition, value)
            with self.assertRaises(ProtocolError):
                validate_artifact_value(definition, {**value, "extra": item})

    def test_real_producer_evaluator_duplicate_forwarding_and_automatic_cleanup(self):
        commands = [[sys.executable, str(ROOT / "conformance/run-0/components/artifacts.py")]]
        bun = shutil.which("bun")
        if bun:
            commands.append([bun, str(ROOT / "conformance/run-0/components/artifacts.ts")])
        for command in commands:
            with self.subTest(component=command[-1]), tempfile.TemporaryDirectory() as directory:
                host = ArtifactHost(directory, command)
                source = Path(directory) / "initial"
                source.mkdir()
                (source / "candidate.txt").write_text("revision=0\n", encoding="utf-8")
                initial = host.grant("root", source)
                result = host.invoke("root", {"role": "coordinate"}, {
                    "source": {"path": str(source), "access": "read", "artifact": initial},
                })
                self.assertEqual(result["output"], {
                    "matches": True, "duplicate": True, "distinct": True,
                    "conflicts": 3, "released": True,
                })
                self.assertEqual((result["artifacts"]["final"] / "candidate.txt").read_text(), "revision=2\n")
                self.assertEqual(host.allocations, 2)
                self.assertEqual(host.launches, 6)
                self.assertEqual(host.rights, {})
                self.assertFalse((Path(directory) / "output-1").exists())
                # chmod restoration permits ordinary temporary-tree cleanup.
                for tree in host.trees.values():
                    tree.chmod(0o755)

    def test_release_preserves_accepted_sibling_borrows_and_duplicate_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            host = ArtifactHost(directory, [])
            ref = host.grant("root", Path(directory))
            first = host.borrow("root", ref)
            second = host.borrow("root", ref)
            request = {"operationId": "release:1", "artifact": ref}
            self.assertEqual(host.operation("root", "flow/artifact/release", request), {})
            self.assertEqual(host.operation("root", "flow/artifact/release", request), {})
            self.assertEqual(first, second)
            with self.assertRaisesRegex(Refusal, "PERMISSION_DENIED"):
                host.borrow("root", ref)
            with self.assertRaisesRegex(Refusal, "OPERATION_CONFLICT"):
                host.operation("root", "flow/artifact/release", {**request, "artifact": "unknown:1"})
