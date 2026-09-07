"""Build and qualify one wheel/sdist pair; candidate mode uses clean Git source."""
from __future__ import annotations

import argparse
import hashlib
import gzip
import os
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--candidate", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        parser.error("output must be a fresh destination")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if args.candidate and subprocess.check_output(
        ["git", "status", "--porcelain"], cwd=ROOT, text=True
    ).strip():
        parser.error("candidate construction requires a clean checkout")
    with tempfile.TemporaryDirectory(prefix="flowmd-build-") as tmp:
        temporary = Path(tmp)
        source = temporary / "source"
        if args.candidate:
            archive = temporary / "source.tar"
            with archive.open("wb") as stream:
                subprocess.run(["git", "archive", revision, "packages/flowmd-sdk"], cwd=ROOT, stdout=stream, check=True)
            with tarfile.open(archive) as packed:
                packed.extractall(temporary / "checkout", filter="data")
            shutil.copytree(temporary / "checkout/packages/flowmd-sdk", source)
        else:
            shutil.copytree(ROOT / "packages/flowmd-sdk", source,
                            ignore=shutil.ignore_patterns("__pycache__", "dist", "build", "*.egg-info"))
        version = tomllib.loads((source / "pyproject.toml").read_text())["project"]["version"]
        dist = temporary / "dist"
        # Stable package-source time also permits unchanged packages to converge
        # on later repository commits without replacing immutable registry bytes.
        epoch = int(subprocess.check_output(
            ["git", "log", "-1", "--format=%ct", revision, "--",
             *[f"packages/flowmd-sdk/{name}" for name in
               ("pyproject.toml", "MANIFEST.in", "README.md", "LICENSE", "src", "tests")]],
            cwd=ROOT, text=True).strip())
        build_env = dict(os.environ, SOURCE_DATE_EPOCH=str(epoch))
        subprocess.run([sys.executable, "-m", "build", "--outdir", str(dist), str(source)], check=True, env=build_env)
        # setuptools' sdist gzip/tar timestamps are otherwise wall-clock/source
        # checkout times. Normalize metadata before testing/freezing the archive.
        for archive in dist.glob("*.tar.gz"):
            normalized = temporary / "normalized.tar.gz"
            with tarfile.open(archive) as original, normalized.open("wb") as raw:
                with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=epoch) as compressed:
                    with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as target:
                        for member in sorted(original.getmembers(), key=lambda item: item.name):
                            member.mtime = epoch
                            member.uid = member.gid = 0
                            member.uname = member.gname = ""
                            member.pax_headers = {}
                            target.addfile(member, original.extractfile(member) if member.isfile() else None)
            shutil.copyfile(normalized, archive)
        files = sorted(dist.iterdir())
        if len(files) != 2 or not any(p.suffix == ".whl" for p in files) or not any(p.name.endswith(".tar.gz") for p in files):
            raise RuntimeError("expected exactly one wheel and one sdist")
        subprocess.run([sys.executable, "-m", "twine", "check", "--strict", *map(str, files)], check=True)
        subprocess.run([sys.executable, str(source / "tests/package_smoke.py"), *map(str, files)], check=True)
        receipt = {"package": "flowmd-sdk", "version": version, "commit": revision,
                   "candidate": args.candidate,
                   "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
        (dist / "SUCCESS.json").write_text(json.dumps(receipt, indent=2) + "\n")
        output.parent.mkdir(parents=True, exist_ok=True)
        # Refuse an output that appeared while building; never replace it.
        output.mkdir()
        for p in dist.iterdir():
            shutil.copyfile(p, output / p.name)
    print(output)


if __name__ == "__main__":
    main()
