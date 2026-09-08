# Python FLOW SDK

## Purpose

Implements the dependency-free Python projection of Run SDK/1 and Run/1. It
is independently packaged for PyPI prereleases; Jig hosting is outside its scope.

## Ownership

- `src/jiggy/flow/` owns the typed public module and runtime implementation.
- `tests/` owns JSON/1, subprocess, concurrency, cancellation, and artifact
  evidence.
- `justfile` owns Python build and test commands; `scripts/build-python-sdk.py`
  assembles and qualifies retained wheel/sdist candidates.
- `pyproject.toml`, `MANIFEST.in`, `README.md`, and `LICENSE` own the distribution envelope.

## Local Contracts

- `jiggy.flow.__init__` and `py.typed` define the public surface; underscore
  modules are private.
- `jiggy` is a native namespace package: no `jiggy/__init__.py`.
  The distribution is `jiggy-flow`; its public import is `jiggy.flow`.
- Importing the package performs no protocol I/O or global mutation.
- `handle()` owns exactly one root Run and protocol standard I/O; application
  output after entry is redirected to standard error.
- Python names may be idiomatic, but wire keys, JSON/1 limits, errors,
  cancellation, and terminal behavior remain Run/1-exact.
- `run_child_flow()` emits `flow/run-child`; `call_capability()` emits
  `capability/call`. `CapabilityError` represents declared capability errors;
  `OperationError` retains operational failure semantics.
- Direct channels exchange JSON/1 values through `run.channel()`, declared
  `run.channels`, and ordinary call `channels=` maps. `_channels.py` owns typed
  endpoint behavior; `_runtime.py` owns correlated wire requests and retained
  cancellation settlement. The host alone decides actual endpoint transfer
  and implicit writer sealing. No broadcast or binary support is claimed.
- Receivers use one async iterator and explicit `aclose()`/async context
  management for early exit. Disposal exposes previously unexposed terminal
  errors after prior reads settle. Ordinary `try/except` requires no extra
  acknowledgement; active resource abandonment and fatal owner state still
  prevent success. Reserve settlement inside existing wire ceilings.
- The runtime supports Python 3.11 or newer without third-party runtime
  dependencies.

## Work Guidance

- Preserve Python's `bool` versus `int` distinction in JSON/1 validation.
- Test thread/event-loop coordination and terminal-write races through
  subprocess behavior.
- Keep typing, validation, examples, and package metadata aligned.
- Run installed distributions outside the checkout with no source-path injection.
- Qualify Python 3.11–3.14 and representative Linux/macOS/Windows interpreters;
  CI configuration is not evidence that a particular run passed.
- Windows checks are portability evidence, not a product support commitment.
  Limit Windows-specific work to inexpensive fixes; broader support needs owner direction.

## Verification

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=packages/jiggy-flow/src python3 -m unittest discover -s packages/jiggy-flow/tests -p 'test_*.py' -v`

- `PYTHON=/absolute/python just python::pack /fresh/output` builds both formats
  and runs strict metadata, installed runtime and typed-consumer checks.

## Child DOX Index

- None.
