"""Summarize inert host evidence; only complete exact-revision proof qualifies."""

import json
import re
import sys
import subprocess
from datetime import datetime
from pathlib import Path


def read_json(path):
    return json.loads(path.read_text())


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
    # One source-pinned validator owns every report, marker and command inventory.
    # This module only projects its validated facts and optional runner timing.
    result = subprocess.run(
        ["node", str(Path(__file__).with_name("test-reports.mjs")), architecture, revision, str(evidence)],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode:
        raise ValueError("complete source-pinned Mac evidence was refused")
    report = json.loads(result.stdout)
    if len(report["shards"]) != count:
        raise ValueError("wrong architecture shard count")
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
    for row in report["shards"]:
        row["timing"] = timings.get(row["shard"])
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
    lines.extend(["", f"Executed cases: **{report['executed']}**. Skipped or filtered cases are not executed proof and reject selected whole-file qualification.", "",
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
    try:
        report = summarize(architecture, revision, int(count), Path(evidence), jobs)
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        report = {"architecture": architecture, "revision": revision, "qualified": False,
                  "executed": 0, "skipped_reports": 0, "failures": 0, "errors": ["Complete source-pinned Mac evidence refused"],
                  "shards": [], "timing_available": False}
    Path(output).write_text(json.dumps(report, indent=2) + "\n")
    print(markdown(report))
    sys.exit(0 if report["qualified"] else 1)
