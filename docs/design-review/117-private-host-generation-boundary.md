# Private host-generation retention boundary

**Status:** reviewed private boundary and measured feasibility result. No host
generation is admitted, rooted, or exposed through a public API.

This review replaces the reverted host-extension Blob experiment. It records
why trusted host code is not another coordinator-owned content store, what the
smallest current implementation generation contains, and the exact host
capability still missing before a Python/Linux recipe may be `READY`.

## 1. One generation, two roles

The current private Python/Linux implementation cannot be split into an
independent Adapter bundle and Backend bundle. Its authenticity checks use
module-local `WeakSet`s; values created by a second evaluation of those modules
are intentionally rejected.

The smallest honest generation therefore has two members:

```text
python-linux-coordinator/1
    Python/Nix runtime observation
    exact Python planning and execution
    Linux Backend construction

linux-cgroup-helper/1
    the separately executed privileged cgroup helper
```

The coordinator is evaluated once. Its closed ESM surface is:

```text
privateHostExtensionAbi = "jig-private-python-linux-coordinator/1"
createBackend
execute
observeRuntime
plan
```

The helper remains a program rather than an imported coordinator module. A
future three-role design is earned only after the Adapter consumes a strictly
decoded inert Backend port instead of trying to authenticate an object branded
by another module instance.

This is a private compatibility boundary, not a generic registry. There are no
aliases, priorities, version ranges, configurable entrypoints, or project-
selectable implementation paths.

## 2. Measured bundle and load proof

Two self-contained Bun ESM bundles were built from the current implementation:

| Member | Bytes | SHA-256 |
|---|---:|---|
| coordinator | 438,120 | `c27688c035f11db72bb82dfec1e3e02f749cbcfcf1586efe17cbc759559dbe46` |
| helper | 12,693 | `f7bbbb6966a10947a6dea98a454c89b285a586bb383502767b4629d11bc34b7c` |

Adding each flat file to the active daemon-backed Nix store produced a
root-owned, mode `0444` regular file with identical bytes. The temporary build
directory was then deleted. In a fresh root Bubblewrap process, the repository
path was replaced with an empty `tmpfs`, the environment was cleared, and Bun
was invoked with:

```text
--no-env-file --no-install --config=/dev/null
```

The coordinator loaded from its Nix path, exposed exactly the five expected
exports, and ran the real observer against Python 3.13.14. The observer
reacquired a 22-store runtime closure and reproduced its exact private digest.
The helper also ran from its Nix path with the checkout hidden and failed with
its expected exit status 70 when deliberately given no trusted arguments.

This proves checkout-independent bundling and loading. It does not prove
durable retention, safe admission, or helper lifecycle recovery.

Production privileged-helper execution must retain the same closed startup
posture. The coordinator remains unprivileged; root in the feasibility probe
was used only to create the isolated inspection namespace. The exact Bun
runtime and an empty root-owned configuration are host-generation members or
dependencies. Root Bun receives an explicit empty environment, fixed working
directory, `--no-env-file`, `--no-install`, and the fixed config; it never
inherits project `.env`, `bunfig.toml`, home, or current-directory policy.

## 3. Why the private Blob store was reverted

The Blob experiment was a careful 1,269-line implementation and corpus for
retaining opaque coordinator-owned bytes. It was reverted because it did not
close the next security boundary:

- coordinator-owned mode `0400` bytes are not a root-owned helper;
- opaque bytes do not prove role, ABI, bundle closure, or loadability;
- Python, Bun, Nix, Bubblewrap, shell, and their required closures still need
  lifecycle retention;
- no production admission record consumed the Blob reference; and
- it duplicated filesystem publication and recovery machinery before a second
  storage implementation was required.

The trusted generation should instead be one atomic immutable installation:

```text
python-linux-host-generation/1
├── registration.json
├── coordinator.mjs
├── cgroup-helper.mjs
└── exact references to its runtime support closures
```

Its closed canonical registration identifies the two fixed ABIs, relative
member paths, byte counts, and domain-separated member digests. It contains no
volatile boot ID, cgroup inode, controller availability, or scope-emptiness
facts. Those belong to a fresh activation preflight receipt.

The generation object must embed every member or carry registered Nix
reference edges to it. A `/nix/store/...` string in `registration.json` is not
itself a Nix reference edge and cannot retain a runtime closure.

One generation object and one lifecycle root avoid partially retaining a pair
of role objects. A later non-Nix implementation may justify a storage-neutral
host-generation boundary; v1 does not invent one in advance.

Nix ownership is not authorization: any caller may add bytes to the store.
Before a generation may be rooted or loaded, its canonical registration and
generation digest must match one exact authenticated host-policy registration.
The privileged launcher accepts only that registered helper and its registered
Bun closure, never an arbitrary root-owned path supplied by a project or Flow.

## 4. Exact unavailable host capability

The active Nix store is reached through a remote daemon socket. Inside this
environment, `/nix/var/nix/gcroots` is a client-mount symlink to
`/cache/nix/gcroots`; it is not the collector's root namespace. Even
root-owned direct links created beneath that client path were ignored by the
active daemon collector. Both exact proof objects appeared in
`nix-store --gc --print-dead` while those links existed. No garbage collection
was run.

`sudo` does not provide the supported lifecycle: it has more authority in the
same client mount namespace and its separate local-store view is not the active
daemon collector. Profiles have the same namespace problem. Temporary daemon
roots die with the connection and therefore do not survive coordinator
failure. The daemon worker protocol can create a permanent root, but this
environment exposes no supported matching enumeration and safe-removal path;
using that one-way operation would trade collection for unreconcilable leaks.

The missing capability is exact:

> A trusted collector-namespace GC-root registrar/remover, or a shared
> collector-visible root directory, restricted to Jig-owned names and store
> objects and reconcilable after coordinator failure.

It is host administration, not a Flow, Binding, Sandbox Backend choice, or
project grant. Flow code must never receive it. A conforming implementation
must support no-replace creation, exact-target reacquisition, removal only
after all durable owners retire, and enumeration sufficient to reconcile a
coordinator crash. The root for a generation must retain the complete Nix
reference closure, not merely make textual store paths appear valid.

Root publication is not complete until the collector-visible link and parent
directory are durably synchronized and a separate query to the active
collector confirms the exact generation is live. Failure to synchronize or
confirm leaves the candidate `UNAVAILABLE`; protected admission state may not
refer to an unconfirmed root.

Unsupported worker-protocol calls, temporary roots, open descriptors, Nix
validity checks, or assumptions that collection is infrequent are not
substitutes. Until the capability exists, this Python/Linux recipe is exactly
`UNAVAILABLE`; it cannot be promoted by the reverted coordinator-owned Blob
copy.

## 5. Remaining `READY` gates

Collector-visible retention is necessary but not sufficient. A runnable
generation still needs:

1. a canonical generation builder and strict acquirer;
2. an authenticated host-policy registration for its exact generation digest;
3. a durably published, collector-confirmed generation root and complete
   execution-closure proof;
4. durable ownership for every trusted executable used after admission:
   coordinator/helper Bun, Python, Nix query tool, Bubblewrap, shell, and their
   required closures, with the privileged launcher and root registrar either
   included or separately retained and reverified as host mechanisms;
5. a root-owned helper launch with empty environment and fixed Bun policy;
6. a root-owned per-spawn recovery lock held from before admission through
   cgroup cleanup;
7. persisted owner, spawn-intent, materialization, and coordinator-epoch
   identities;
8. restart fencing before backing or roots are released; and
9. lock-first admission persistence and exact post-lock reverification.

The present helper kills and cleans its tree when the coordinator channel is
lost, but recovery cannot treat a missing cgroup as final until it acquires the
same per-spawn lock. No document or test may call the current recipe `READY`.

## 6. Next executable slice

Work can continue without weakening this gate. The next slice is one strict
private `UNAVAILABLE` admission path:

```text
canonical unavailable candidate
    -> durable visible lock publication
    -> exact lock-byte reverification
    -> one protected local admission compare-and-set
    -> immutable admission record whose sole target remains unavailable
```

It exercises consent ordering, crash recovery, restart reacquisition, and
generation CAS without needing or impersonating a runnable host generation.
The admission record's digest names that generation and the same stored record
is its idempotent receipt; there is no duplicate unauthenticated approval row.
The later `READY` branch must add all gates above; it cannot reuse
`UNAVAILABLE` as evidence of execution support.
