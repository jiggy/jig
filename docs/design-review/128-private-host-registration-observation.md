# Private host-registration observation checkpoint

**Status:** implemented and host-tested private authentication observation.
It binds one administrator-installed registration to one exact retained
Python/Linux generation intent, but deliberately produces only process-local
`admissible: false` evidence. It does not acquire execution authority, launch
the helper, connect admission, or make the recipe `READY`.

This checkpoint closes only the record-observation part of the host-policy
boundary left open by
[review 127](127-private-host-root-convergence.md). The production source of
the trusted anchor and expected registration digest remains a host-bootstrap
concern and must be fixed into protected acquisition state before the
restricted launcher consumes it.

## 1. Trust begins at an explicit anchor

The observer accepts exactly three pieces of trusted host input:

```text
registration anchor { canonical path, device, inode }
one bounded direct-child registration name
expected registration-record digest
```

The anchor identity and expected digest must come from trusted host
configuration. A project, Flow, Package, Binding, or arbitrary caller may not
choose them. The observer does not infer trust from a pathname or by walking
ownership to `/`.

Before its first asynchronous operation, the observer snapshots the complete
request and nested anchor exactly once. Only the expected enumerable data
properties are accepted; accessors are rejected. Later checks use only those
inert locals, so a getter or Proxy cannot change trusted input between
validation and comparison.

That boundary is intentional. A host used during development exposed an
unusual ownership layout in which requiring every ancestor through `/` would
reject an otherwise usable root-installed subtree. Special-casing `/` would
instead turn an environmental accident into authorization. An isolated mount
namespace would prove only its fixture. The reviewed answer is one explicit,
already-trusted anchor whose canonical path and live device/inode identity are
pinned by the host.

The implementation opens the anchor, requires a root-owned exact mode `0755`
directory, and matches the supplied device and inode. It then accepts only one
lowercase bounded path component and opens that direct child through the
anchor descriptor. The registration root must be root-owned mode `0755` on
the same filesystem. No ancestor above the anchor participates in the
identity. The claim is limited to the current mount namespace.

## 2. Canonical registration record

The registration root contains exactly:

```text
<trusted-anchor>/<name>/
├── registration.json
└── state/
```

`registration.json` is one root-owned, single-link, mode `0444`, bounded
regular file on the anchor filesystem. Its canonical JSON/1 plus LF value is:

```text
kind: python-linux-host-registration/1
generationDigest: sha256:...
stateRoot:
  path: <fixed direct child>
  device: <canonical unsigned decimal>
  inode: <canonical unsigned decimal>
  ownerUid: <canonical unsigned decimal>
digest: JIG-Python-Linux-Host-Registration/1(...)
```

The embedded digest proves canonical record integrity. Authentication also
requires equality with the independently supplied expected record digest;
the record cannot select itself. The `state` directory must be the exact
canonical direct child, owned by Jig's effective user, mode `0700`, on the
same filesystem, and match all recorded identity fields.

There is deliberately no production registration writer. The host
administrator or a separate trusted bootstrap/registrar owns installation and
policy replacement. A later restricted execution launcher only consumes an
authenticated fixed registration selection. Jig currently implements only a
strict observer, so this slice cannot turn user-controlled bytes into root
policy.

## 3. Observation and revalidation

After opening the anchor, registration root, record, and state directory, the
observer:

1. rejects every extra or missing registration-root entry;
2. strictly decodes the canonical record and checks the expected digest;
3. descriptor-confines and authenticates the recorded state directory;
4. reads the existing immutable SQLite generation intent without staging or
   converging roots;
5. independently reobserves the complete protected generation roles and Nix
   closure evidence twice through the root-intent verifier;
6. requires the recorded generation and state identity to equal that live
   intent; and
7. rechecks the anchor, direct child, record bytes and inode, state identity,
   and exact directory entries before returning.

The operation issues no `--add-root`, launch, admission, acquisition, or
retirement effect. It uses the existing protected SQLite checker; ordinary
SQLite recovery of already-existing storage is not promoted into host-policy
mutation authority.

The result contains only immutable identities and digests:

```text
kind: python-linux-host-registration-observation/1
admissible: false
registration observation digest
registration-record digest
generation digest
root-intent observation digest
anchor, registration-root, registration-file, and state identities
```

It contains no executable callback, generation object, launch arguments,
capability, grant, or live handle. A module-local brand rejects decoded,
copied, or cross-process lookalikes.

## 4. Host corpus

The dedicated host corpus creates an ephemeral root-owned anchor under
`/run/host-services`, installs the record only through test authority, and
proves:

- concurrent observations agree and create zero Nix root effects;
- fresh-process observation reproduces the same deterministic observation
  digest but not the local brand;
- a user-owned lookalike is rejected;
- wrong trusted anchor identity, unsafe anchor mode, invalid child names,
  accessors or changing Proxy values, wrong expected record digest, unsafe
  record mode or hard links, unsafe state mode, wrong state identity,
  generation conflict, and alternate encodings all fail closed; and
- replacing the record with byte-identical content while live generation
  verification is paused changes its inode and is rejected by the final
  recheck; and
- replacing the registered state directory while the same verification is
  paused is rejected before an observation can be returned; and
- replacing either the registration root or the trusted anchor during that
  pause is rejected, after which restoring the original identity permits a
  fresh observation.

Every ephemeral anchor and state tree is removed before the corpus succeeds.
The tests do not establish a production trusted-input channel merely by
injecting test authority.

## 5. Nonclaims and next gate

This checkpoint does not prove:

- how production Jig receives the trusted anchor identity and expected digest;
- that the active Nix daemon can dereference this exact state-root path;
- collector retention or arbitrary-power-loss durability;
- acquisition, lease, active ownership, replacement, retirement, or deletion;
- a restricted root-owned helper launch or active Backend preflight;
- durable spawn ownership, coordinator epochs, or restart fencing;
- lock-first admission connection; or
- resistance to a malicious host administrator or mount-namespace authority.

The next qualifying slice must not widen this observer. It must first establish
a trusted production source for the anchor and expected digest plus the
confined daemon-visible retention mechanism required by
[review 129](129-private-nix-reachability-blocker.md). Durable acquisition
must then create one lock-first, one-shot admitted spawn intent before a
restricted launcher can consume it. The launcher obtains the fixed selection
solely from the protected acquisition record and host-owned configuration,
never caller-selected helper paths or raw arguments. Within
that acquisition and recovery owner, Jig must freshly observe the
registration, reconverge and reverify the exact generation, and run the active
Backend preflight before package code. Until those gates and restart-safe
lifecycle ownership are proven, the Python/Linux recipe remains `UNAVAILABLE`.
