# Private process-local exact Python launch checkpoint

**Status:** implemented and host-proven private, invocation-local,
non-admissible checkpoint. It publishes no Runtime Adapter, Sandbox Backend,
recipe decoder, lock, admission, or general Python API.

This slice converts one authentic direct-Run activation request into one
process-local candidate whose package, Python runtime, Backend mechanism,
policy, authority, limits, environment, and derivation revisions are fixed in
the candidate itself. It then reacquires the retained `Package/1`, derives one
fixed launch without fallback, executes Run/1, fences the complete process
tree, and only then removes the materialized package.

## 1. Closed candidate

The private candidate fixes:

```text
authentic direct Flow target and activation-request digest
exact PackageArtifactRef and flow.py entrypoint
preparation: none
authenticated Python/Nix runtime observation
authenticated Linux cgroup-v2/Bubblewrap mechanism observation
host-policy digest
fixed empty-authority posture
fixed Python environment
runtimePredicates: []
finite cgroup and Run-host limits
logical /component, /component/flow.py, and /work locations
private Adapter and launch-planner revision labels
```

Its domain-separated digest excludes the Run ID, caller input, absolute
deadline, materialization path, cgroup nonce, PID, file descriptor, and live
process. Those belong to one execution receipt rather than candidate identity.

Both the activation request and candidate are invocation-local factory values.
A structurally identical object is rejected. Persisted values will later need
a closed decoder which reacquires all referenced artifacts before
reauthenticating them.

The candidate carries `admissible: false`. Its factory authenticity is valid
only inside the loaded coordinator process. It is not a retained exact Adapter
recipe and cannot cross Lock/1 or admission. That is an enforced architectural
boundary, not a TODO label which callers may reinterpret.

## 2. Runtime and mechanism observations

The runtime observer realpaths and hashes the exact Python and Nix multi-call
executables, records the exact Python version, invokes the latter with the
fixed `nix-store` `argv[0]`, and obtains the root runtime's complete Nix
closure. It admits 1–256 canonical, unique, root-owned, non-writable store
directories, sorts them canonically, requires the Python root, and
domain-separates the complete observation.

The Backend observer passively records and hashes the selected backend, helper,
Bubblewrap, coordinator Bun, sudo launcher, and shell files. It also records
the canonical empty cgroup-v2 scope identity, required controllers, payload
identity, launch mode, and startup limit. It is mechanism identity, not a
general readiness certificate or a complete transitive host-extension artifact
identity. Actual child-cgroup creation and `sudo -n`
authorization remain fail-fast launch proofs.

The Backend re-observes the mechanism and compares the candidate pin before
the privileged helper is spawned. It computes a separate sealed-plan digest
after mount sources are realpathed. That per-Run receipt includes the exact
ordered mounts, command, environment, limits, predicate booleans, payload
identity, and mechanism digest; it is not candidate identity.

The private executor also authenticates the exact frozen Backend instance. A
structurally compatible object cannot echo the expected mechanism digest and
replace `launch` with an unenforced process path. Future modular Backends need
an authenticated host registration boundary; security-critical duck typing is
not that boundary.

## 3. Exact package boundary

Planning and execution independently reacquire the exact
`PackageArtifactRef`. Inspection must still report a selector-free `flow.py`
Run matching the authentic direct target. The first recipe rejects these
root preparation sources with `PYTHON_PREPARATION_UNSUPPORTED`:

```text
Pipfile, Pipfile.lock, pdm.lock, poetry.lock, pylock.toml,
pyproject.toml, requirements.lock, requirements.txt,
setup.cfg, setup.py, uv.lock
```

This is deliberately narrow. Ignoring dependency metadata would not make
preparation absent. The package must contain its complete Python component
implementation and any importable support it needs. The proof vendors the
canonical allowlist of `flowmd_sdk` sources into Package/1 and implements the
fixture through `serve`; no `__pycache__`, bytecode, live repository SDK, or
test-fixture mount enters activation.

Conventional input and result schemas are recompiled from the retained
package. Input is validated before materialization or payload dispatch, and a
successful protocol result is validated before the host returns it.

## 4. Ownership protocol

The trusted helper now uses an explicit admission handshake:

```text
helper connects
    -> coordinator owns the socket and terminal reader
    -> coordinator sends admit
    -> helper may create the cgroup
```

A connection timeout or coordinator failure before `admit` therefore owns no
cgroup. This removes the late-connect race in which a timed-out helper could
previously begin host mutation without a receipt owner.

The coordinator installs abort handling and checks an already-aborted signal
before sending `admit`. Cancellation before admission therefore cannot create
a cgroup or dispatch package code; after admission every failure requires the
terminal fence protocol.

Cancellation and the hard deadline kill both the fixed trampoline PID and the
Run cgroup. After the trampoline reports placement, the helper rechecks stop
state and issues a fresh kill before it can announce readiness. Kill failures
are captured; they never bypass the final `populated 0` check, directory
removal, or terminal receipt.

Every post-admission setup failure returns a terminal receipt. A launch is
releasable only after that receipt reports `fenced: true`, no cleanup error,
and the helper has exited. The Backend raises a distinct unconfirmed-fence
error otherwise.

The execution owner follows this order on every path after launch:

```text
terminate idempotently
    -> await the shared completion receipt
    -> require fenced: true and no cleanup error
    -> dispose the package materialization
```

An unconfirmed fence deliberately transfers the complete materialization owner
into a typed quarantine error. Reporting a path while dropping the disposal
capability would itself leak ownership; deleting possibly mounted backing
would turn an ownership failure into a use-after-delete race.

## 5. Realized authority

The exact Python launch has:

```text
network: false
extra host filesystem: false
attachments: false
Flow calls: false
capability/effect calls: false
ambient/caller environment: false
private memory-accounted scratch: /work
rootProcessMappings: false
entropyDevice: false
```

The fixed environment contains only Python determinism/transport controls:

```text
PYTHONCOERCECLOCALE=0
PYTHONDONTWRITEBYTECODE=1
PYTHONUNBUFFERED=1
PYTHONUTF8=1
```

The guest proof observes `/dev/urandom`, `/proc/self/maps`, and
`/sys/fs/cgroup` as absent. This proves only that those paths are absent; it
does not claim that the `getrandom(2)` syscall is unavailable.

## 6. Evidence

The hostile Linux corpus proves that the exact candidate:

- is derived from an authentic retained project and Package/1 request;
- rejects a preparation-bearing Python package;
- has stable identity across repeated planning and changes identity when a
  finite limit changes;
- rejects a forged candidate lookalike;
- validates retained input schema before launch;
- continues to execute after the visible source project is deleted;
- uses the exact observed Python executable and closure;
- receives only the fixed environment and private `/work` cwd;
- runs a child and grandchild through the same finite runtime closure;
- has neither entropy-device nor root-proc predicate enabled;
- executes the vendored Python Run SDK through a schema-valid Run/1 result;
- surfaces a retained result-schema violation only after a clean fence;
- cancels a sleeping SDK handler and removes its cgroup and materialization;
- reports clean CPU, memory, and PID evidence for the fixture;
- removes every `jig-run-*` cgroup; and
- removes its `jig-package-*` materialization only after fencing.

The complete hostile suite still proves fork-storm, aggregate memory,
throttling plus wall deadline, startup/shutdown cancellation, orphan cleanup,
coordinator loss, repeated Runs, and the negative Bun descendant gate.

## 7. Why this is not READY

Four durable obligations remain deliberately absent:

1. The complete Runtime Adapter/launch-planner and Backend implementation
   closures are not yet externally retained, authenticated host-extension
   artifacts (or closed artifact manifests). Revision labels, factory
   provenance, and individual file hashes are sufficient only for this
   process-local, non-admissible witness.
2. Nix store closure paths have no Jig-owned GC roots or renewable leases.
3. A coordinator crash can leave a safely fenced materialization needing a
   recovery collector, even though the trusted helper removes the cgroup.
4. Candidate authentication is process-local; there is no strict persisted
   recipe decoder and reacquisition transaction.

The observer also assumes the selected Nix store and trusted host mechanism
are protected from hostile same-UID mutation between realpath/hash and
kernel use. General protection against a compromised coordinator would need
administrator-owned immutable installation or descriptor/image-based mount
realization, not more FLOW metadata.

The next checkpoint begins with a strict private package-project lock
projection, then admission persistence. The projection must prove that inert
portable evidence cannot absorb host activation fields; it is not the final
public `jig.lock` schema while upstream source provenance, Hooks, Semantic
Choice, and host-capability registration identities remain open. Admission
must additionally reacquire every referenced artifact, establish the missing
runtime/materialization lifecycle roots, and only then mint a generation. This
checkpoint must never be promoted merely by changing `admissible: false` to
`true`.
