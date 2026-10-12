#!/usr/bin/env python3
"""Bind disposable application test reports to unchanged repository test bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


def normalize(report, mapping_file, repository, revision=None):
    mapping = json.loads(Path(mapping_file).read_text())
    if not isinstance(mapping, list) or not mapping:
        raise ValueError("missing source test mapping")
    files = {}
    root = Path(repository).resolve()
    for item in mapping:
        original = item["source"]
        source = root / original
        copied = Path(item["copy"])
        if source.is_symlink() or copied.is_symlink() or source.resolve() != source or copied.resolve() != copied:
            raise ValueError("source test mapping cannot alias a path")
        if (not source.is_relative_to(root) or Path(original).is_absolute()
                or not source.is_file() or not copied.is_file()
                or original in files.values() or str(copied) in files):
            raise ValueError("invalid source test identity")
        if hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(copied.read_bytes()).digest():
            raise ValueError("copied test differs from repository source")
        if revision is not None:
            retained = subprocess.check_output(["git", "-C", str(root), "show", f"{revision}:{original}"])
            if retained != copied.read_bytes():
                raise ValueError("copied test differs from pinned source revision")
        files[str(copied)] = original
    tree = ET.parse(report)
    xml_root = tree.getroot()
    if xml_root.tag not in ("testsuite", "testsuites"):
        raise ValueError("invalid source report")
    cases = list(xml_root.iter("testcase"))
    if xml_root.get("tests") is not None and int(xml_root.get("tests")) != len(cases):
        raise ValueError("incomplete source report")
    if any(int(suite.get(key, "0")) for suite in xml_root.iter() if suite.tag in ("testsuite", "testsuites") for key in ("failures", "errors", "skipped")):
        raise ValueError("failed or skipped source report")
    observed = set()
    if not cases or any(case.find(tag) is not None for case in cases for tag in ("failure", "error", "skipped")):
        raise ValueError("failed, skipped or empty source report")
    for case in cases:
        file = str(Path(case.attrib["file"]).resolve())
        if file not in files:
            raise ValueError("reported test is outside the copied source inventory")
        case.set("file", files[file])
        observed.add(file)
    if observed != set(files):
        raise ValueError("source report omits a copied test file")
    tree.write(report, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--revision")
    args = parser.parse_args()
    normalize(args.report, args.mapping, args.repository, args.revision)
