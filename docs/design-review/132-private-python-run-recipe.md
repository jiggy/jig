# Private retained Python Run recipe

**Status:** implemented execution checkpoint. This proves one exact Python
Run/1 component in the private Linux envelope. It does not yet create a
`READY` admission, public Runtime Adapter, public Sandbox Backend, dependency
preparer, or durable root-Run controller.

## 1. Closed proof recipe

The proof host explicitly materializes `python314` and retains its complete
closure under the outer sandbox lease. Jig receives one exact read-only
receipt basename and executable path from trusted test configuration. The
private runtime-support observer now accepts either the rootfs receipt or one
exact `need-<digest>.json` receipt. It validates the receipt kind, lease,
selected output, bounded closure, canonical paths, read-only mounts, and exact
executable bytes.

The package fixture is deliberately dependency-free at activation time. It
vendors the tracked `flowmd_sdk` Python package beside `flow.py`, then runs:

```text
<leased-python>/bin/python3 /package/flow.py
```

The Backend receives only:

- the receipt-derived Python support closure, mounted read-only at its exact
  paths;
- the fixture package, mounted read-only at `/package`;
- private writable `/work` scratch;
- protocol stdin/stdout and bounded stderr; and
- finite cgroup CPU, memory, PID, wall-clock, and cleanup limits.

It receives no ambient environment or `PATH`, network, host filesystem,
writable cgroup control, package-manager operation, Nix daemon authority,
root-process mappings, or entropy-device exception.

## 2. Result

The real Python SDK accepted `flow/run`, returned the requested output, exited
cleanly, and left no cgroup residue. The complete proof-host suite now reports:

```text
14 pass
0 fail
129 assertions
```

This closes an important earlier uncertainty: Python plus the Run/1 SDK can
satisfy the existing containment contract without the Bun-specific
`/proc/self/maps` exception.

## 3. What this does not admit

The receipt selection currently belongs to proof-host test configuration. A
Flow package cannot request an installable, select a receipt, search the host,
or invoke `need`. Repeating identical materialization receipts are accepted by
the test fixture only when they yield the same authenticated observation; the
platform observer itself always consumes one exact basename.

The test package vendors the SDK to avoid inventing dependency preparation.
This is a valid Package/1 shape, not a claim that every Python package must
vendor dependencies. Native dependency inspection and preparation remain a
future Adapter concern.

The exact request-to-recipe binding and protected Package/1 execution seam are
now implemented in [review 133](133-private-python-recipe-planner.md).

Most importantly, a successful process launch is still not a `READY`
admission. The next checkpoint must persist only the stable evidence needed to
re-plan it, compare the re-planned observation after restart, and preserve the
existing lock-first admission rules. Only then may a durable root-Run
submission consume it.
