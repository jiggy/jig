"""Execute the public platform-guide host snippet against controlled peers."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


REPOSITORY = Path(__file__).resolve().parents[3]
GUIDE = REPOSITORY / "docs/flow/guide/platforms.md"
NODE = shutil.which("node")

# The fixtures validate the host's actual wire requests. They deliberately do
# not import an SDK or supply containment; installed-SDK verification is separate.
FIXTURE = r"""
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
const role = ROLE;
const mode = MODE;
const lines = createInterface({ input: process.stdin });
let entered = false;
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
lines.on("line", line => {
  const message = JSON.parse(line);
  if (!entered) {
    entered = true;
    assert.equal(message.jsonrpc, "2.0");
    assert.equal(message.method, "flow/run");
    assert.equal(message.id, role === "caller" ? "host:1" : "host:greeter:1");
    assert.deepEqual(Object.keys(message.params).sort(),
      ["protocol", "input", "settings", "attachments", "scratch", "deadlineUnixMs"].sort());
    assert.equal(message.params.protocol, "run/0");
    assert.equal(message.params.input, "Ada");
    assert.ok(message.params.deadlineUnixMs > Date.now());
    assert.ok(message.params.scratch.endsWith("/" + role));
    if (role === "caller") {
      send({jsonrpc: "2.0", id: "component:1", method: "flow/call", params: {
        slot: mode === "ungranted" ? "other" : "greeter",
        operationId: "greet:1", input: message.params.input
      }});
      return;
    }
    if (mode === "timeout") {
      setInterval(() => {}, 1000);
      return;
    }
    const result = {outcome: "done", output: {message: "Hello, Ada!"}};
    if (mode === "missing-output") delete result.output;
    send({jsonrpc: "2.0", id: mode === "wrong-id" ? "other:1" : message.id, result});
  } else {
    assert.equal(role, "caller");
    assert.equal(message.id, "component:1");
    send({jsonrpc: "2.0", id: "host:1", result: message.result});
  }
  if (mode === "trailing") process.stdout.write("unexpected bytes");
  if (mode === "nonzero") process.exitCode = 7;
  lines.close();
});
"""


@unittest.skipUnless(NODE, "Node is required for the controlled guide peers")
class GuideHostTests(unittest.TestCase):
    def run_example(self, *, caller="normal", greeter="normal"):
        source = GUIDE.read_text()
        snippets = re.findall(r"^```python\n([\s\S]*?)^```$", source, re.MULTILINE)
        self.assertEqual(len(snippets), 1, "the executable host snippet must be identifiable")
        with tempfile.TemporaryDirectory(prefix="flow-guide-") as directory:
            root = Path(directory)
            (root / "greeter").mkdir()
            (root / "host.py").write_text(snippets[0])
            shutil.copy(Path(__file__).with_name("run0_peer.py"), root / "run0_peer.py")
            for path, role, mode in [
                (root / "FLOW.mjs", "caller", caller),
                (root / "greeter/FLOW.mjs", "greeter", greeter),
            ]:
                path.write_text(
                    FIXTURE.replace("ROLE", json.dumps(role)).replace("MODE", json.dumps(mode))
                )
            return subprocess.run(
                [sys.executable, "host.py"],
                cwd=root,
                env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True,
                text=True,
                timeout=12,
                check=False,
            )

    def test_exercises_entry_dependency_call_and_complete_result(self):
        completed = self.run_example()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(
            json.loads(completed.stdout),
            {"outcome": "done", "output": {"message": "Hello, Ada!"}},
        )

    def test_does_not_publish_success_after_invalid_or_unsettled_execution(self):
        cases = [
            ({"greeter": "missing-output"}, "expected exactly object members"),
            ({"greeter": "wrong-id"}, "Unexpected response ID"),
            ({"caller": "ungranted"}, "granted route"),
            ({"greeter": "nonzero"}, "component exited 7"),
            ({"caller": "nonzero"}, "component exited 7"),
            ({"greeter": "trailing"}, "unexpected bytes after its root response"),
            ({"caller": "trailing"}, "unexpected bytes after its root response"),
            ({"greeter": "timeout"}, "timed out waiting for a component frame"),
        ]
        for options, diagnostic in cases:
            with self.subTest(options=options):
                completed = self.run_example(**options)
                self.assertNotEqual(completed.returncode, 0)
                self.assertEqual(completed.stdout, "")
                self.assertIn(diagnostic, completed.stderr)


if __name__ == "__main__":
    unittest.main()
