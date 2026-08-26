# Private Python/Linux real-bundle checkpoint

**Status:** implemented and host-tested private artifact/load checkpoint. The
ordinary Jig build now emits the exact coordinator and helper programs used by
the private Python/Linux generation. This proves checkout-independent loading,
one-evaluation coordinator compatibility, and real helper behavior. It does
not root, admit, authorize, recover, or activate a host generation.

## 1. Exact build products

`bun run build` emits two independent, unsplit Bun ESM bundles:

```text
dist/internal/python-linux-coordinator.bundle.js
dist/internal/linux-cgroup-helper.bundle.js
```

Both builds fix:

```text
target: bun
format: esm
packages: bundle
sourcemap: none
build-time environment substitution: disabled
```

No local module or package is externalized. The measured checkpoint artifacts
are:

| Role | Bytes | SHA-256 |
|---|---:|---|
| coordinator | 442,152 | `fdd1bfa2e4aa163c18fbd1af4bafd38351fa33f3a43effbbc5a4a7bc4dd7b614` |
| helper | 13,695 | `bfe4528e0e8909bdc0d46d4e36c3d84fd50586241493f4ceae82947256602ac0` |

These are evidence for this source revision, not stable names or manually
pinned specification constants. Host-generation identity is derived from the
actual emitted bytes.

## 2. Closed coordinator surface

The coordinator exports exactly:

```text
privateHostExtensionAbi = "jig-private-python-linux-coordinator/1"
createBackend
execute
observeRuntime
plan
```

`createBackend` requires the exact helper path in both its TypeScript and
runtime boundary. A flat Nix coordinator object cannot use the source class's
adjacent-file default. `plan` consumes the canonical planning-intent bytes
defined by [review 125](125-private-python-planning-intent.md), so a host
request is not incorrectly tested against the bundle's distinct `WeakSet`.

The hostile corpus also loads the emitted coordinator once and completes this
same-evaluation chain:

```text
observeRuntime
    -> createBackend(exact helper)
    -> observe Backend mechanism
    -> plan(authentic host-projected intent)
    -> execute(bundle candidate, bundle Backend, pre-aborted signal)
```

The final operation reaches the deliberate pre-activation cancellation gate.
No package or cgroup is launched by that regression. It proves the runtime,
Backend, and candidate brands compose within one coordinator evaluation.

## 3. Checkout-independent load proof

The host gate adds the exact two build outputs as flat objects to the active
daemon Nix store and verifies their source/store byte identities. It then
observes the real eight-role generation and re-queries every unique member's
complete Nix closure.

A fresh root-created Bubblewrap inspection namespace exposes beneath
`/nix/store` only the sorted union of those exact closure objects. It does
**not** bind all of `/nix/store`, the checkout, an ancestor `node_modules`, a
package cache, or a home directory. The checkout's `/home` ancestor is replaced
by a `tmpfs`.

The trusted inspection process explicitly names the additional facilities it
uses:

```text
new /dev and /proc
private /tmp and /run
read-only passwd file
read-only Nix daemon socket directory
```

These are named observer-bootstrap inputs, not generation-closure members or
Flow/package grants. The passwd file is required because Nix otherwise aborts
while resolving the root user's home under an empty environment. The daemon
socket is required only for the fresh closure queries. Bubblewrap sets `PWD`
after `--clearenv`, so an exact no-startup Bash inside the namespace performs a
second `exec -c` before Bun. The coordinator therefore starts as namespace
uid 0 with cwd `/`, an actually empty environment, and the three fixed policy
flags:

```text
--no-env-file
--no-install
--config=/dev/null
```

Those flags precede the fixed `--eval` inspection probe; they are not a claim
that the probe has no program argument.

It exposes the five exact exports and reproduces the independently observed
Python runtime digest and closure count. Separately bundled `plan` first
rejects noncanonical intent while using its local runtime, then accepts valid
intent through decoding and runtime reverification before rejecting a
deliberately foreign Backend observation at the expected brand gate.

Every trusted inspection subprocess has an isolated process group, a
20-second deadline, 1 MiB limit on each output stream, and fatal UTF-8
decoding. Limit failure kills both the process group and its leader and waits
for close. Bubblewrap additionally runs as PID 1 for the namespace with
`--die-with-parent`, so inspection descendants cannot outlive the launcher.

## 4. Real helper proof

The stored helper is always executed as a program. Under the exact root,
cwd, environment, and Bun posture it reaches its closed argument parser and
exits 70 for the expected missing `--scope`, before any cgroup mutation.
Independent negative runs prove rejection of:

- non-root identity;
- cwd drift;
- ambient environment; and
- Bun policy drift.

A second host gate loads the Nix coordinator in the trusted host, creates its
Backend with the Nix helper path, and runs one benign Bash payload inside the
real cgroup-v2/Bubblewrap envelope. The mechanism receipt names the exact
coordinator and helper Nix paths. The payload exits zero, the helper returns a
clean fence and evidence, and the Run cgroup is gone. The complete hostile
Linux corpus still passes with no residual Jig cgroup.

This uses the broad development `sudo` only as test evidence. It is not the
future restricted launcher or qualifying host-policy authorization.

## 5. Remaining boundary

This checkpoint establishes emitted bytes and behavior, not reproducible
builds, signatures, GC retention, or production authority. It adds no:

- durable generation intent, root convergence, or recovery;
- authenticated host registration or restricted launcher;
- active readiness receipt tied to protected admission;
- restart-safe spawn owner, generation acquisition, lease, retirement, or
  deletion authority; or
- public Runtime Adapter, Sandbox Backend, or host-generation API.

The subsequent
[retain-only convergence checkpoint](127-private-host-root-convergence.md)
stores one immutable generation decision and unconditionally re-adds every
exact root with local rechecks. It produces no passive completion receipt:
same-path daemon reachability, production acquisition, and retirement remain
closed until Jig has authenticated host-global state and restart-safe spawn
ownership.
