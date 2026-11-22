"""Compare two actual Contact Import Runs in one packed Explorer session."""

import http.client
import importlib.util
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import signal
import sys
import time
import traceback


helper = importlib.util.spec_from_file_location(
    "installed_explore", Path(__file__).with_name("installed-explore.py")
)
explore = importlib.util.module_from_spec(helper)
helper.loader.exec_module(explore)
require = explore.require


def main(cli):
    deadline = time.monotonic() + 180
    owner = None
    review = None
    phase = "open"
    try:
        owner = explore.TerminalOwner([cli, "explore", "binding:code", "--timeout", "1m"])
        link = None
        while link is None:
            require(time.monotonic() < deadline and owner.process.poll() is None)
            owner.pump()
            link = explore.LINK.search(owner.output["stderr"])
        port = int(link.group(1))
        capability = link.group(2)
        origin = f"http://127.0.0.1:{port}"

        def request(path, body=None, content_type=None):
            require(time.monotonic() < deadline)
            headers = {"Authorization": "Bearer " + capability.decode("ascii")}
            if body is not None:
                headers["Origin"] = origin
            if content_type is not None:
                headers["Content-Type"] = content_type
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            try:
                connection.request("GET" if body is None else "POST", path, body, headers)
                response = connection.getresponse()
                data = response.read(explore.HTTP_LIMIT + 1)
                require(response.status == 200 and len(data) <= explore.HTTP_LIMIT)
                require(capability not in data)
                return json.loads(data)
            finally:
                connection.close()

        source = Path("fixtures/known/contacts.csv").read_bytes()
        boundary = b"jig-contact-import-fixture"
        require(boundary not in source)

        def submit(project, request_id):
            intent = json.dumps({
                "requestId": request_id,
                "revision": project["revision"],
                "targetId": project["selected"]["targetId"],
                "input": {},
            }).encode()
            parts = [
                b"--" + boundary,
                b'Content-Disposition: form-data; name="_intent"; filename="intent.json"',
                b"Content-Type: application/json", b"", intent,
                b"--" + boundary,
                b'Content-Disposition: form-data; name="source"; filename="contacts.csv"',
                b"Content-Type: text/csv", b"", source,
                b"--" + boundary + b"--", b"",
            ]
            # A later submission joins the previous inspector. Keep draining its
            # inherited terminal streams while the server waits for that exit.
            with ThreadPoolExecutor(max_workers=1) as worker:
                response = worker.submit(
                    request, "/api/run", b"\r\n".join(parts),
                    "multipart/form-data; boundary=" + boundary.decode("ascii"),
                )
                while not response.done():
                    owner.pump()
                return response.result()

        def run(project, request_id):
            status = submit(project, request_id)
            while status["state"] != "settled":
                require(status["state"] in ("starting", "running"))
                require(status["requestId"] == request_id and owner.process.poll() is None)
                owner.pump()
                time.sleep(0.05)
                status = request("/api/run")
            require(status["requestId"] == request_id)
            comparison = status["comparison"]
            require(comparison["root"] == "binding:code")
            require(comparison["revision"] == project["revision"])
            evidence = comparison["evidence"]
            if evidence["callCoverage"] != "complete":
                print(json.dumps({
                    "execution": evidence["execution"],
                    "coverage": evidence["callCoverage"],
                    "omitted": evidence["callsOmitted"],
                    "recorded": len(evidence["calls"]),
                }), file=sys.stderr)
            require(evidence["callCoverage"] == "complete" and evidence["callsOmitted"] == 0)
            require(evidence["execution"] == "succeeded" and json.loads(evidence["outcome"]) == "done")
            require(evidence["files"] == {"total": 1, "paths": ["preview/preview.json"]})
            require("callEvidence" not in status)
            return comparison

        phase = "earlier-approval"
        earlier_project = request("/api/project")
        require(request("/api/run") == {"state": "idle"})
        earlier = run(earlier_project, "early-contact-import")

        phase = "local-review"
        project_path = Path("jig.ts")
        project_source = project_path.read_text()
        require(project_source.count("'bindings/code.ts',") == 1)
        project_path.write_text(project_source.replace(
            "'bindings/code.ts',", "'bindings/code.ts',\n    'bindings/map-code.ts',"
        ))
        binding_path = Path("bindings/code.ts")
        binding_source = binding_path.read_text()
        require(binding_source.count("mapper: 'flow:flows/map-code'") == 1)
        binding_path.write_text(binding_source.replace(
            "mapper: 'flow:flows/map-code'", "mapper: 'binding:map-code'"
        ))
        Path("bindings/map-code.ts").write_text(
            "import { defineBinding } from '@jigging/jig'\n"
            "export default defineBinding({ package: 'flows/map-code' })\n"
        )
        review = explore.TerminalOwner([cli, "review", "--yes", "--allow-authority-changes"])
        require(review.wait(deadline) == 0)
        review.close()
        review = None

        phase = "stale-approval-and-refresh"
        stale = submit(earlier_project, "stale-contact-import")
        require(stale["state"] == "refused" and "comparison" not in stale)
        later_project = request("/api/project")
        require(later_project["revision"] != earlier_project["revision"])
        require(later_project["selected"]["targetId"] != earlier_project["selected"]["targetId"])
        require(request("/api/run") == stale)

        phase = "later-approval"
        later = run(later_project, "later-contact-import")
        require(earlier["inputId"] == later["inputId"])
        expected = {
            "reader": "flow:flows/read-contacts",
            "converter": "flow:flows/convert",
            "exporter": "flow:flows/export-preview",
        }
        for comparison, mapper in ((earlier, "flow:flows/map-code"), (later, "binding:map-code")):
            calls = comparison["evidence"]["calls"]
            require(len(calls) == 4)
            require({call["slot"]: call["target"] for call in calls} == dict(expected, mapper=mapper))
            require(all(call["caller"] == "binding:code" and "parent" not in call and
                        call["state"] == "returned" and call["outcome"] == "done" for call in calls))
        require(submit(later_project, "later-contact-import")["comparison"] == later)

        phase = "join"
        require(request("/api/close", b"") == {"closed": True})
        require(owner.wait(deadline) == 0)
        destinations = re.findall(rb'^  Output: ("[^\r\n]+")\r?$', owner.output["stderr"], re.M)
        require(len(destinations) == 2 and len(set(destinations)) == 2)
        for destination in destinations:
            packet = Path(json.loads(destination))
            result = json.loads((packet / "result.json").read_bytes())
            require(result["status"] == "succeeded" and "callEvidence" not in result)
            preview = json.loads((packet / "files/preview/preview.json").read_bytes())
            require(preview == result["output"] and len(preview["accepted"]) == 2)
        print(json.dumps({
            "earlier": {key: earlier[key] for key in ("revision", "root", "evidence")},
            "later": {key: later[key] for key in ("revision", "root", "evidence")},
            "sameSubmittedInput": True,
            "staleApprovalRefused": True,
            "duplicateRequestDidNotReplay": True,
        }))
        return 0
    except Exception as error:
        lines = [str(frame.lineno) for frame in traceback.extract_tb(error.__traceback__)
                 if frame.filename == __file__]
        failure = {
            "application": "contact-explorer-comparison",
            "stage": phase,
            "code": type(error).__name__,
        }
        if lines:
            failure["operation"] = "lines-" + "-".join(lines[-6:])
        if isinstance(error, OSError) and error.errno is not None:
            failure["terminalCode"] = f"errno-{error.errno}"
        else:
            terminal = review if review is not None else owner
            if terminal is not None:
                code = terminal.process.poll()
                if code is not None:
                    failure["terminalCode"] = f"exit-{code}"
        print("Foundation client failure: " + json.dumps(failure), file=sys.stderr)
        return 1
    finally:
        if review is not None:
            review.close()
        if owner is not None:
            owner.close()


if __name__ == "__main__":
    for number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(number, explore.terminal.interrupted)
    sys.exit(main(sys.argv[1]))
