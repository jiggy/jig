"""Summarize inert host evidence; only complete exact-revision proof qualifies."""

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET


def read_json(path):
    return json.loads(path.read_text())


def test_counts(path):
    root = ET.parse(path).getroot()
    if root.tag not in ("testsuites", "testsuite"):
        raise ValueError("invalid JUnit root")
    cases = list(root.iter("testcase"))
    executed = [c for c in cases if c.find("skipped") is None]
    failures = sum(c.find("failure") is not None or c.find("error") is not None for c in cases)
    files = {c.get("file") for c in cases}
    if None in files or "" in files or any(not c.get("name") for c in cases):
        raise ValueError("missing testcase file")
    return (
        {
            "executed": len(executed),
            "skipped_reports": len(cases) - len(executed),
            "failures": failures,
        },
        {(c.get("file"), c.get("classname"), c.get("name"), c.get("line")) for c in executed},
        files,
    )


def duration(start, end):
    result = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()
    if result < 0:
        raise ValueError("timestamp order")
    return result


def summarize(architecture, revision, count, evidence, jobs):
    if architecture not in ("x64", "arm64") or not re.fullmatch("[0-9a-f]{40}", revision):
        raise ValueError("invalid architecture or revision")
    if type(count) is not int or count not in (2, 3):
        raise ValueError("invalid shard count")
    report = {
        "architecture": architecture,
        "revision": revision,
        "qualified": False,
        "executed": 0,
        "skipped_reports": 0,
        "failures": 0,
        "errors": [],
        "shards": [],
        "timing_available": False,
    }
    errors = report["errors"]
    # The API is optional diagnostic evidence. It cannot establish qualification.
    timings = {}
    if isinstance(jobs, list):
        for job in jobs:
            if not isinstance(job, dict):
                continue
            for shard in range(count):
                if job.get("name") != f"Native host shard — {architecture} / {shard}":
                    continue
                try:
                    if job["status"] != "completed":
                        continue
                    timings[shard] = {
                        "wait_seconds": duration(job["created_at"], job["started_at"]),
                        "job_seconds": duration(job["started_at"], job["completed_at"]),
                    }
                except (KeyError, TypeError, ValueError):
                    pass
    report["timing_available"] = len(timings) == count
    seen_cases = set()
    for shard in range(count):
        directory = evidence / f"macos-prerequisites-{architecture}-{shard}-{revision}"
        row = {
            "shard": shard,
            "executed": 0,
            "skipped_reports": 0,
            "failures": 0,
            "timing": timings.get(shard),
        }
        report["shards"].append(row)
        try:
            marker = (directory / f"shard-{shard}.complete").read_text().strip()
            if marker != f"{revision} {architecture} {shard}":
                errors.append(f"Shard {shard}: wrong revision or architecture marker")
        except (OSError, UnicodeError):
            errors.append(f"Shard {shard}: missing completion marker")
        try:
            plan = read_json(directory / "test-plan.json")
            if (
                plan["architecture"] != architecture
                or type(plan["shard"]) is not int
                or plan["shard"] != shard
                or type(plan["shardCount"]) is not int
                or plan["shardCount"] != count
                or plan["installed"] is not (shard == count - 1)
            ):
                raise ValueError("plan identity")
            groups = plan["groups"]
            native = plan["nativeFiles"]
            if not isinstance(groups, list) or not groups or not isinstance(native, list):
                raise ValueError("plan groups")
            if bool(native) != (shard == 0):
                raise ValueError("native prerequisite plan")
            if any(
                not isinstance(group, dict)
                or not isinstance(group.get("file"), str)
                or not group["file"]
                for group in groups
            ):
                raise ValueError("plan file")
            if any(not isinstance(file, str) or not file for file in native):
                raise ValueError("native file")
            paths = [
                (directory / f"shard-{shard}-group-{i}.xml", {group["file"]})
                for i, group in enumerate(groups)
            ]
            if native:
                paths.append((directory / "native-tests.xml", set(native)))
            if plan["installed"]:
                paths.append((
                    directory / "installed-startup.xml",
                    {"packages/jig/test/native-agent-startup.test.ts"},
                ))
        except (OSError, ValueError, KeyError, TypeError):
            errors.append(f"Shard {shard}: missing or invalid test plan")
            continue
        for path, expected_files in paths:
            try:
                counts, cases, files = test_counts(path)
                if files and files != expected_files:
                    raise ValueError("testcase file does not match plan")
                if (
                    path.name in ("native-tests.xml", "installed-startup.xml")
                    and not counts["executed"]
                ):
                    raise ValueError("native prerequisite proof is empty")
                if cases & seen_cases:
                    errors.append(f"Shard {shard}: repeated execution across test groups")
                seen_cases.update(cases)
                for key in counts:
                    row[key] += counts[key]
                    report[key] += counts[key]
            except (OSError, ET.ParseError, ValueError):
                errors.append(f"Shard {shard}: missing or invalid {path.name}")
        if row["failures"]:
            errors.append(f"Shard {shard}: failed test cases")
    report["qualified"] = not errors
    return report


def markdown(report):
    lines = [f"### Mac host proof — {report['architecture']}", "",
             f"Revision: `{report['revision']}`. Qualification: **{'passed' if report['qualified'] else 'failed'}**.", "",
             "| Shard | Runner wait | Job execution | Executed cases | Skipped reports | Failed cases |",
             "| --- | --- | --- | --- | --- | --- |"]
    for row in report["shards"]:
        timing = row["timing"]
        wait = f"{timing['wait_seconds']:.0f}s" if timing else "unavailable"
        execution = f"{timing['job_seconds']:.0f}s" if timing else "unavailable"
        lines.append(f"| {row['shard']} | {wait} | {execution} | {row['executed']} | {row['skipped_reports']} | {row['failures']} |")
    lines.extend(["", f"Executed cases: **{report['executed']}**. Skipped reports include name-partition filters and platform/opt-in skips; they are not executed proof.", "",
                  "Counts cover planned Bun source, native and installed-client startup tests. Packed consumer CLI probes, archive identity and residue checks are additionally required by completion markers.", "",
                  "Runner wait is measured from job creation to runner start. Job execution includes setup, proof and cleanup; neither value is a per-test runtime."])
    if not report["timing_available"]:
        lines.extend(["", "Some job timings are unavailable. Qualification uses completion markers and test reports, independently of the timing API."])
    lines.extend(["", *[f"- {error}" for error in report["errors"]]])
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 7:
        sys.exit("Expected architecture, revision, shard count, evidence, jobs and output paths")
    architecture, revision, count, evidence, jobs_path, output = sys.argv[1:]
    try:
        jobs = read_json(Path(jobs_path))
    except (OSError, ValueError):
        jobs = None
    report = summarize(architecture, revision, int(count), Path(evidence), jobs)
    Path(output).write_text(json.dumps(report, indent=2) + "\n")
    print(markdown(report))
    sys.exit(0 if report["qualified"] else 1)
