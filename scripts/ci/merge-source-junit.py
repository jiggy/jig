#!/usr/bin/env python3
"""Combine completed source reports without changing case identities or credit."""
import argparse
from pathlib import Path
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("output")
parser.add_argument("reports", nargs="+")
parser.add_argument("--files")
args = parser.parse_args()
root = ET.Element("testsuites")
count = 0
observed = set()
identities = set()
for path in args.reports:
    source = ET.parse(path).getroot()
    if source.tag not in ("testsuites", "testsuite"):
        raise ValueError("invalid source report root")
    cases = list(source.iter("testcase"))
    if not cases or any(case.find(tag) is not None for case in cases for tag in ("skipped", "failure", "error")):
        raise ValueError("empty, failed or skipped source report")
    if source.get("tests") is not None and int(source.get("tests")) != len(cases):
        raise ValueError("incomplete source report")
    for suite in source.iter():
        if suite.tag in ("testsuite", "testsuites") and any(int(suite.get(key, "0")) for key in ("failures", "errors", "skipped")):
            raise ValueError("failed or skipped source report")
    for case in cases:
        file = case.get("file", "").removeprefix("./")
        name = case.get("name", "")
        if not file or not name.strip():
            raise ValueError("missing source case identity")
        identity = (file, case.get("classname", ""), name)
        if identity in identities:
            raise ValueError("repeated source case identity")
        identities.add(identity)
        observed.add(file)
    count += len(cases)
    root.append(source)
if not count:
    raise ValueError("missing source reports")
if args.files:
    expected = Path(args.files).read_text().splitlines()
    if not expected or len(expected) != len(set(expected)) or observed != set(expected):
        raise ValueError("source report does not cover its exact selected files")
root.set("tests", str(count))
ET.ElementTree(root).write(args.output, encoding="utf-8", xml_declaration=True)
