# Python FLOW SDK

## Purpose

Implements the dependency-free Python projection of Run SDK/1 and Run/1. It
remains a private candidate.

## Ownership

- `src/flowmd_sdk/` owns the typed public module and runtime implementation.
- `tests/` owns JSON/1, subprocess, concurrency, cancellation, and artifact
  evidence.
- `pyproject.toml`, `README.md`, and `LICENSE` own the distribution envelope.

## Local Contracts

- `flowmd_sdk.__init__` and `py.typed` define the public surface; underscore
  modules are private.
- Importing the package performs no protocol I/O or global mutation.
- `handle()` owns exactly one root Run and protocol standard I/O; application
  output after entry is redirected to standard error.
- Python names may be idiomatic, but wire keys, JSON/1 limits, errors,
  cancellation, and terminal behavior remain Run/1-exact.
- The runtime supports Python 3.11 or newer without third-party runtime
  dependencies.

## Work Guidance

- Preserve Python's `bool` versus `int` distinction in JSON/1 validation.
- Test thread/event-loop coordination and terminal-write races through
  subprocess behavior.
- Keep typing, validation, examples, and package metadata aligned.

## Verification

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=packages/flowmd-sdk/src python3 -m unittest discover -s packages/flowmd-sdk/tests -p 'test_*.py' -v`

## Child DOX Index

- None.
