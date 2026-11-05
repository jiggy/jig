"""Real installed explorer, approved input, duplicate refusal and native Run ownership.

The caller supplies one reviewed ordinary greeting project and owns native residue
checks. This helper uses only the public installed CLI and authenticated HTTP.
It emits closed check labels, never capabilities, input values or private paths.
"""

import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import sys
import time


helper = importlib.util.spec_from_file_location(
    "installed_web_terminal", Path(__file__).with_name("installed-saved-web.py")
)
terminal = importlib.util.module_from_spec(helper)
helper.loader.exec_module(terminal)
require = terminal.require
TerminalOwner = terminal.TerminalOwner
LINK = re.compile(rb"http://127\.0\.0\.1:(\d+)/explore#cap=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])")
VIEWER = re.compile(r"http://127\.0\.0\.1:([1-9][0-9]{0,4})/#cap=([A-Za-z0-9_-]{43})")
HTTP_LIMIT = 16 * 1024 * 1024
CHECKS = [
    "approved-map-before-run", "invalid-input-without-launch", "stale-approval-refusal",
    "refresh-after-review", "ordinary-live-inspector", "duplicate-request-no-replay",
    "closed-inspector-run-again", "sequential-run-owners", "busy-request-lookup",
    "active-close-cancellation", "joined-explorer-exit",
]


def main():
    deadline = time.monotonic() + 210
    owner = None
    review = None
    phase = "open"
    passed = False
    code = None
    previous_signals = {
        number: signal.signal(number, terminal.interrupted)
        for number in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        owner = TerminalOwner([sys.argv[1], "explore", "flow:flows/hello", "--timeout", "1m"])
        link = None
        while link is None:
            require(time.monotonic() < deadline and owner.process.poll() is None)
            owner.pump()
            link = LINK.search(owner.output["stderr"])
        port = int(link.group(1))
        capability = link.group(2).decode("ascii")
        origin = "http://127.0.0.1:" + str(port)

        def request(path, method="GET", body=None, endpoint=None):
            require(time.monotonic() < deadline)
            selected_port, selected_cap = endpoint or (port, capability)
            connection = http.client.HTTPConnection(
                "127.0.0.1", selected_port, timeout=min(10, deadline - time.monotonic())
            )
            try:
                headers = {"Authorization": "Bearer " + selected_cap}
                encoded = None
                if method == "POST":
                    headers["Origin"] = "http://127.0.0.1:" + str(selected_port)
                if body is not None:
                    headers["Content-Type"] = "application/json"
                    encoded = json.dumps(body, separators=(",", ":")).encode()
                connection.request(method, path, body=encoded, headers=headers)
                response = connection.getresponse()
                data = response.read(HTTP_LIMIT + 1)
                require(len(data) <= HTTP_LIMIT and capability.encode() not in data)
                require(response.status == 200)
                return json.loads(data)
            finally:
                connection.close()

        def state_until(wanted):
            while True:
                require(time.monotonic() < deadline and owner.process.poll() is None)
                owner.pump()
                state = request("/api/run")
                require(state["state"] not in ("refused", "uncertain"))
                if state["state"] in wanted:
                    return state

        def inspect_viewer(url, settled):
            match = VIEWER.fullmatch(url)
            require(match is not None)
            endpoint = (int(match.group(1)), match.group(2))
            while True:
                snapshot = request("/api/snapshot", endpoint=endpoint)
                require(snapshot["kind"] == "snapshot" and snapshot["mode"] == "live-run")
                require(snapshot["composition"]["state"] == "available")
                if not settled or snapshot["workspace"]["phase"] == "settled":
                    break
                owner.pump()
            if settled:
                require(snapshot["workspace"]["facts"]["execution"]["value"] == "succeeded")

        phase = "approved-map-before-run"
        project = request("/api/project")
        require(project["kind"] == "project" and project["state"] == "approved")
        require(project["selected"]["composition"]["state"] == "available")
        require(project["selected"]["launch"]["state"] == "available")
        require(request("/api/run") == {"state": "idle"})
        require(not owner.output["stdout"])
        original_revision = project["revision"]
        original_target = project["selected"]["targetId"]

        def intent(identity, value, selected=project):
            return {"requestId": identity, "revision": selected["revision"],
                    "targetId": selected["selected"]["targetId"], "input": value}

        phase = "invalid-input-without-launch"
        invalid = request("/api/run", "POST", intent("invalid-input", {"private-value": 1}))
        require(invalid["state"] == "refused" and "string" in invalid["reason"])
        require("private-value" not in invalid["reason"])
        require(not owner.output["stdout"])

        phase = "stale-approval-refusal"
        metadata_path = Path("flows/hello/FLOW.meta.json")
        metadata = json.loads(metadata_path.read_text())
        metadata["description"] = "A reviewed greeting for the explorer qualification."
        metadata_path.write_text(json.dumps(metadata) + "\n")
        review = TerminalOwner([sys.argv[1], "review", "--yes", "--allow-resolution-network"])
        require(review.wait(deadline) == 0)
        review.close()
        review = None
        stale = request("/api/run", "POST", intent("stale-approval", "Ada"))
        require(stale["state"] == "refused")
        require(not owner.output["stdout"])

        phase = "refresh-after-review"
        current = request("/api/project")
        require(current["revision"] != original_revision)
        require(current["selected"]["targetId"] != original_target)
        first_request = intent("first-run", "Ada", current)
        first = request("/api/run", "POST", first_request)
        require(first["state"] in ("starting", "running", "settled"))
        first = state_until({"running", "settled"})
        first_url = first["viewerUrl"]
        phase = "ordinary-live-inspector"
        inspect_viewer(first_url, True)
        require(state_until({"settled"})["requestId"] == "first-run")

        phase = "duplicate-request-no-replay"
        duplicate = request("/api/run", "POST", first_request)
        require(duplicate["state"] == "settled" and duplicate["viewerUrl"] == first_url)
        conflict = dict(first_request, input="Changed")
        require(request("/api/run", "POST", conflict)["state"] == "refused")
        require(request("/api/run")["requestId"] == "first-run")

        phase = "closed-inspector-run-again"
        first_endpoint = VIEWER.fullmatch(first_url)
        require(first_endpoint is not None)
        require(request("/api/close", "POST", endpoint=(
            int(first_endpoint.group(1)), first_endpoint.group(2)
        )) == {"closed": True})
        # Immediately submit through the still-open explorer. The exact previous
        # command must be joined even if its inspector listener has already closed.
        phase = "sequential-run-owners"
        second = request("/api/run", "POST", intent("second-run", "Grace", current))
        require(second["state"] in ("starting", "running", "settled"))
        second = state_until({"running", "settled"})
        require(second["viewerUrl"] != first_url)
        inspect_viewer(second["viewerUrl"], True)
        require(state_until({"settled"})["requestId"] == "second-run")
        require(request("/api/run", "POST", first_request)["state"] == "settled")
        require(request("/api/run")["requestId"] == "second-run")

        phase = "active-close-cancellation"
        held = request("/api/run", "POST", intent("held-run", "Hold", current))
        require(held["state"] in ("starting", "running"))
        held = state_until({"running"})
        inspect_viewer(held["viewerUrl"], False)
        phase = "busy-request-lookup"
        busy = request("/api/run", "POST", intent("busy-run", "Changed", current))
        require(busy["state"] == "refused" and busy["requestId"] == "busy-run")
        require(request("/api/run?requestId=busy-run") == busy)
        active = request("/api/run")
        require(active["state"] == "running" and active["requestId"] == "held-run")
        phase = "active-close-cancellation"
        require(request("/api/close", "POST") == {"closed": True})
        phase = "joined-explorer-exit"
        code = owner.wait(deadline)
        require(code == 0)
        stdout = bytes(owner.output["stdout"])
        require(stdout.count(b"Hello, Ada!") == 1)
        require(stdout.count(b"Hello, Grace!") == 1)
        require(b"Hello, Changed!" not in stdout and b"Hello, Hold!" not in stdout)
        require(b"CANCELLED" in stdout + bytes(owner.output["stderr"]))
        passed = True
    except BaseException:
        # Request exceptions can contain the private capability; expose only a fixed phase.
        pass
    finally:
        for number in previous_signals:
            signal.signal(number, signal.SIG_IGN)
        if review is not None:
            review.close()
        if owner is not None:
            owner.close()
            code = owner.process.returncode
        for number, handler in previous_signals.items():
            signal.signal(number, handler)
    print(json.dumps({"passed": True, "checks": CHECKS} if passed else {
        "passed": False, "phase": phase, "code": code,
    }))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
