#!/usr/bin/env python3
"""Execute every selected Python source file, including nested suite additions."""
import argparse
import importlib.util
from pathlib import Path
import sys
import unittest

parser = argparse.ArgumentParser()
parser.add_argument("--files", required=True)
parser.add_argument("--group", required=True)
args = parser.parse_args()
repository = Path.cwd().resolve()
paths = [line for line in Path(args.files).read_text().splitlines() if line]
selected = [path for path in paths if path == args.group or path.startswith(args.group.rstrip("/") + "/")]
if not selected or len(set(paths)) != len(paths):
    raise ValueError("missing or repeated selected Python source file")
suite = unittest.TestSuite()
modules = set()
identities = set()

def cases(value):
    if isinstance(value, unittest.TestSuite):
        for child in value:
            yield from cases(child)
    else:
        yield value

for path in selected:
    source = repository / path
    if source.is_symlink() or not source.is_file() or source.resolve() != source or not source.is_relative_to(repository):
        raise ValueError("invalid selected Python source file")
    name = source.stem
    if name in modules:
        raise ValueError("Python source modules require distinct names within their suite")
    modules.add(name)
    sys.path.insert(0, str(source.parent))
    spec = importlib.util.spec_from_file_location(name, source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    tests = unittest.defaultTestLoader.loadTestsFromModule(module)
    discovered = list(cases(tests))
    if not discovered:
        raise ValueError("selected Python file registers no unittest cases")
    for case in discovered:
        if case.id() in identities:
            raise ValueError("repeated Python source case identity")
        identities.add(case.id())
    suite.addTests(discovered)
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful() or result.skipped or result.testsRun != len(identities):
    sys.exit(1)
for path in selected:
    print(f"CI Python source file complete: {path}", flush=True)
