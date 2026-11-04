"""Summarize inert host evidence; only complete exact-revision proof qualifies."""

import json
import os
import re
import stat
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


def positive_integer(value):
    return type(value) is int and 0 < value <= 9007199254740991


def current_run_integer(name):
    value = os.environ.get(name, "")
    if not re.fullmatch("[1-9][0-9]{0,15}", value) or not positive_integer(int(value)):
        raise ValueError("missing current run identity")
    return int(value)


def read_worker_receipt(path):
    # Optional diagnostics read inert, bounded records, without following links
    # or waiting on a FIFO. The cohort validator owns their qualification use.
    if path.parent.resolve(strict=True) != Path(os.path.abspath(path.parent)):
        raise ValueError("linked worker receipt directory")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 8192:
            raise ValueError("worker receipt is not a bounded regular file")
        data = b""
        while len(data) < 8193:
            chunk = os.read(descriptor, 8193 - len(data))
            if not chunk:
                break
            data += chunk
        if len(data) > 8192:
            raise ValueError("worker receipt exceeds its bound")
        return json.loads(data)
    finally:
        os.close(descriptor)


def job_timing(job):
    if job["status"] != "completed":
        raise ValueError("incomplete job timing")
    return {
        "wait_seconds": duration(job["created_at"], job["started_at"]),
        "job_seconds": duration(job["started_at"], job["completed_at"]),
    }


def cohort_jobs(revision, count, evidence, host_profile, jobs):
    try:
        run_id = current_run_integer("GITHUB_RUN_ID")
        run_attempt = current_run_integer("GITHUB_RUN_ATTEMPT")
    except ValueError:
        return {}
    if count != 3:
        return {}
    mappings = []
    for role in range(count):
        try:
            receipt = read_worker_receipt(
                evidence / f"macos-prerequisites-arm64-{role}-{revision}" / "worker.json"
            )
            if (
                not isinstance(receipt, dict)
                or set(receipt) != {"kind", "sourceRevision", "runId", "runAttempt",
                                   "worker", "jobId", "allocatorJobId", "profile", "role",
                                   "readyArtifact", "announcementArtifact", "assignmentArtifact"}
                or receipt["kind"] != "macos-host-cohort-worker/2"
                or receipt["sourceRevision"] != revision
                or not positive_integer(receipt["runId"]) or receipt["runId"] != run_id
                or not positive_integer(receipt["runAttempt"]) or receipt["runAttempt"] != run_attempt
                or type(receipt["role"]) is not int or receipt["role"] != role
                or type(receipt["worker"]) is not int or not 0 <= receipt["worker"] < 5
                or not positive_integer(receipt["jobId"])
                or not positive_integer(receipt["allocatorJobId"])
                or receipt["profile"] != host_profile
            ):
                continue
            name = f"Native host worker — arm64 / {receipt['worker']}"
            matches = [job for job in jobs if isinstance(job, dict)
                       and (job.get("id") == receipt["jobId"] or job.get("name") == name)]
            if len(matches) != 1:
                continue
            job = matches[0]
            if (
                not positive_integer(job.get("id")) or job["id"] != receipt["jobId"]
                or job.get("name") != name
                or not positive_integer(job.get("run_id")) or job["run_id"] != run_id
                or not positive_integer(job.get("run_attempt")) or job["run_attempt"] != run_attempt
                or job.get("conclusion") != "success"
            ):
                continue
            mappings.append((role, receipt["worker"], receipt["jobId"], job_timing(job)))
        except (OSError, ValueError, KeyError, TypeError, RecursionError):
            pass
    # One physical job cannot provide two role mappings, even if an optional
    # receipt was copied or changed after the owning reconciliation completed.
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    valid_repository = re.fullmatch(r"[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+", repository)
    return {role: {"worker": worker, "job_id": job_id, "timing": timing,
                   "job_url": f"https://github.com/{repository}/actions/runs/{run_id}/job/{job_id}"
                   if valid_repository else None}
            for role, worker, job_id, timing in mappings
            if sum(other_worker == worker or other_job == job_id
                   for _, other_worker, other_job, _ in mappings) == 1}


def summarize(architecture, revision, count, evidence, jobs):
    if architecture not in ("x64", "arm64") or not re.fullmatch("[0-9a-f]{40}", revision):
        raise ValueError("invalid architecture or revision")
    if type(count) is not int or count <= 0:
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
    workers = {}
    report["worker_mapping_applicable"] = (
        architecture == "arm64" and os.environ.get("JIG_MACOS_TEST_PLAN") == "pull-request"
    )
    if isinstance(jobs, list):
        if report["worker_mapping_applicable"]:
            workers = cohort_jobs(revision, count, evidence, report["hostProfile"], jobs)
            timings = {role: worker["timing"] for role, worker in workers.items()}
        else:
            for job in jobs:
                if not isinstance(job, dict):
                    continue
                for shard in range(count):
                    if job.get("name") != f"Native host shard — {architecture} / {shard}":
                        continue
                    try:
                        timings[shard] = job_timing(job)
                    except (KeyError, TypeError, ValueError):
                        pass
    report["timing_available"] = len(timings) == count
    for row in report["shards"]:
        row["timing"] = timings.get(row["shard"])
        if report["worker_mapping_applicable"]:
            worker = workers.get(row["shard"], {})
            for field in ("worker", "job_id", "job_url"):
                row[field] = worker.get(field)
    return report


def markdown(report):
    lines = [f"### Mac host proof — {report['architecture']}", "",
             f"Revision: `{report['revision']}`. Qualification: **{'passed' if report['qualified'] else 'failed'}**.", ""]
    if report.get("hostProfile"):
        host = report["hostProfile"]
        lines.extend([f"Tested host: `{host['arch']}` Darwin `{host['kernel']}` build `{host['build']}`, Bun `{host['bun']}` (`{host['revision']}`).", ""])
    if report["qualified"]:
        cohort = report["worker_mapping_applicable"]
        owner = "Role" if cohort else "Shard"
        columns = [owner] + (["Physical worker / job"] if cohort else []) + [
            "Executed files", "Executed cases", "Skipped cases", "Failed/error cases",
            "Runner wait", "Job execution",
        ]
        lines.extend([
            "| " + " | ".join(columns) + " |",
            "| " + " | ".join("---" for _ in columns) + " |",
        ])
        for row in report["shards"]:
            timing = row["timing"]
            wait = f"{timing['wait_seconds']:.0f}s" if timing else "unavailable"
            execution = f"{timing['job_seconds']:.0f}s" if timing else "unavailable"
            cells = [str(row["shard"])]
            if cohort:
                worker = f"Worker {row['worker']}" if row.get("worker") is not None else "unavailable"
                if row.get("job_url"):
                    worker = f"[{worker}]({row['job_url']})"
                cells.append(worker)
            cells.extend(str(row[field]) for field in ("files", "executed", "skipped_reports", "failures"))
            cells.extend([wait, execution])
            lines.append("| " + " | ".join(cells) + " |")
        lines.extend(["", f"Complete planned file coverage: **{report['files']}/{report['planned_files']} files**.",
                      f"Every planned {owner.lower()} has complete reports on the exact host profile above.", "",
                      f"Executed cases: **{report['executed']}**. Skipped or filtered cases reject whole-file qualification.", "",
                      "Counts cover planned source, native and installed-client startup tests. Packed consumer CLI probes, archive identity and residue checks are additionally required by completion markers.", "",
                      "Runner wait is measured from job creation to runner start. Job execution includes setup, proof and cleanup. Neither value is a per-test runtime."])
        if cohort and any(row.get("worker") is None or row.get("job_url") is None for row in report["shards"]):
            lines.extend(["", "Some physical worker mappings or job links are unavailable. No worker identity is inferred from its role number."])
        if not report["timing_available"]:
            lines.extend(["", "Some job timings are unavailable. Qualification uses completion markers and test reports, independently of the timing API."])
    else:
        lines.extend(["Complete planned file coverage: **unavailable**.", "",
                      "Executed files, executed cases, skipped cases and failed/error cases: **unavailable**.",
                      "Complete source-pinned proof was refused. These unavailable counts do not mean zero failures or zero skipped cases."])
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
