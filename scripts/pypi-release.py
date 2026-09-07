"""Prepare missing immutable distributions or verify registry convergence.

Read-only registry operations: upload authority stays in the isolated publisher.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request


class RegistryPending(RuntimeError):
    pass


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=30) as response:
        value = response.read(32 * 1024 * 1024 + 1)
    if len(value) > 32 * 1024 * 1024:
        raise RuntimeError("registry response exceeds distribution limit")
    return value


def candidate(directory: Path, revision: str) -> dict:
    receipt = json.loads((directory / "SUCCESS.json").read_text())
    if receipt.get("package") != "flowmd-sdk" or receipt.get("commit") != revision or receipt.get("candidate") is not True:
        raise ValueError("candidate source/evidence mismatch")
    version = receipt.get("version", "")
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:a|b|rc)(?:0|[1-9][0-9]*)", version):
        raise ValueError("expected one exact Python prerelease version")
    expected = {f"flowmd_sdk-{version}-py3-none-any.whl", f"flowmd_sdk-{version}.tar.gz"}
    if set(receipt.get("files", {})) != expected:
        raise ValueError("candidate must contain the exact wheel and sdist")
    if {p.name for p in directory.iterdir()} != expected | {"SUCCESS.json"}:
        raise ValueError("unexpected candidate files")
    for name, digest in receipt["files"].items():
        path = directory / name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("candidate bytes differ from tested evidence")
    return receipt


def missing(receipt: dict, download=fetch) -> list[str]:
    try:
        remote = json.loads(download(f'https://pypi.org/pypi/flowmd-sdk/{receipt["version"]}/json'))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return sorted(receipt["files"])
        raise
    if remote["info"]["name"] != "flowmd-sdk" or remote["info"]["version"] != receipt["version"]:
        raise ValueError("registry package identity mismatch")
    found = set()
    for file in remote["urls"]:
        name = file["filename"]
        if name in found or name not in receipt["files"] or file.get("yanked"):
            raise ValueError("unexpected, duplicate, or yanked registry artifact")
        if file["digests"]["sha256"] != receipt["files"][name]:
            raise ValueError("immutable registry bytes differ; bump the package version")
        url = urllib.parse.urlsplit(file["url"])
        if url.scheme != "https" or url.netloc != "files.pythonhosted.org":
            raise ValueError("unexpected distribution origin")
        if hashlib.sha256(download(file["url"])).hexdigest() != receipt["files"][name]:
            raise ValueError("downloaded registry bytes differ from tested candidate")
        found.add(name)
    return sorted(set(receipt["files"]) - found)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare", "verify"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("revision")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    receipt = candidate(args.directory, args.revision)
    if args.mode == "prepare":
        if args.output is None or args.output.exists():
            parser.error("prepare requires a fresh --output directory")
        absent = missing(receipt)
        args.output.mkdir(parents=True)
        for name in absent:
            shutil.copyfile(args.directory / name, args.output / name)
        if args.github_output:
            with args.github_output.open("a") as stream:
                stream.write(f'pending={str(bool(absent)).lower()}\nversion={receipt["version"]}\n')
                stream.write(f'new_version={str(len(absent) == 2).lower()}\n')
        print(f"{len(absent)} distributions need publication")
    else:
        for attempt in range(30):
            absent = missing(receipt)
            if not absent:
                print("registry bytes match both tested distributions")
                return
            if attempt < 29:
                time.sleep(5)
        raise RegistryPending("registry has not exposed both distributions; rerun failed jobs")


if __name__ == "__main__":
    main()
