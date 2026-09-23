# Python FLOW SDK

## Purpose

Implements the dependency-free Python projection of Run SDK/0 and Run/0. It
is independently packaged for PyPI prereleases; Jig hosting is outside its scope.

## Ownership

- `src/jiggy/flow/` owns the typed public module and runtime implementation.
- `tests/` owns JSON/0, subprocess, concurrency, cancellation, and artifact
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
- Python names may be idiomatic, but wire keys, JSON/0 limits, errors,
  cancellation, and terminal behavior remain Run/0-exact.
- `call()` emits `flow/call` with operation identity, slot and input, plus optional
  advisory intent and channel mappings. It returns the complete `RunResult`;
  declared domain outcomes remain normal data and `OperationError` represents
  operational failures. The initial single-operation profile has no selector.
  Preserve optional-key presence and ordinary task cancellation semantics.
- Direct and broadcast channels exchange JSON/0 values through `run.channel()`, declared
  `run.channels`, and ordinary call `channels=` maps. `_channels.py` owns typed
  endpoint behavior; `_runtime.py` owns correlated wire requests and retained
  cancellation settlement. The host alone decides actual endpoint transfer
  and implicit writer sealing. Broadcast creation returns a writer and
  creator-only subscription authority; each `subscribe()` allocates an active
  receiver with an explicit suffix start. A source is not a transferable
  endpoint. No binary support is claimed.
  `contract` accepts a local path or `ChannelSlotContract` (`slot`, `channel`),
  resolving a named agreement from the caller's declaration without dispatch.
- Receivers use one async iterator and explicit `aclose()`/async context
  management for early exit. Disposal exposes previously unexposed terminal
  errors after prior reads settle. Ordinary `try/except` requires no extra
  acknowledgement; active resource abandonment and fatal owner state still
  prevent success. Reserve settlement inside existing wire ceilings.
  Cancelled allocations retain late grants until their cleanup settles;
  allocating an unread broadcast subscription still creates a cleanup duty.
- Writer `close(error="LAGGED")` declares incomplete output through ordinary
  channel close, even with pending sends. Retain its settlement on waiter
  cancellation and reject attempts to rewrite a prior clean end. The stream
  failure does not cancel execution or change ordinary `try/except` recovery.
- The runtime supports Python 3.11 or newer without third-party runtime
  dependencies.

## Work Guidance

- Preserve Python's `bool` versus `int` distinction in JSON/0 validation.
- Test thread/event-loop coordination and terminal-write races through
  subprocess behavior. Unit race tests should force the relevant write orders
  and correlate frames by method and request identity; concurrent cancellation
  notifications need not leave a request at the end of captured output.
- Keep typing, validation, examples, and package metadata aligned.
- `pyproject.toml` owns the release version; package checks read it rather than
  duplicating the value. Installation prose links to the package on PyPI and
  uses `--pre`, so routine alpha bumps do not require editorial changes.
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
