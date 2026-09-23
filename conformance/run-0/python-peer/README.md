# Independent Python Run/0 host peer

This directory contains a stdlib-only host implementation used to drive the
TypeScript and Python SDK fixture components through the shared semantic golden
conversation. It imports neither FLOW SDK nor the Bun conformance harness.

Run it with an available Python 3.11+ interpreter:

```console
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s conformance/run-0/python-peer -p 'test_*.py' -v
```

In the development sandbox, Python may instead be supplied by `need`:

```console
PYTHONDONTWRITEBYTECODE=1 need run python3 -- python3 -m unittest discover \
  -s conformance/run-0/python-peer -p 'test_*.py' -v
```

The peer is intentionally test infrastructure, not a public host SDK or a
complete conformance claim. Its strict JSON/0 codec and protocol checks are an
independent implementation of the exercised Run/0 surface.
