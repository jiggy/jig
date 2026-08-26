# Private host-root convergence checkpoint

**Status:** implemented and host-tested private retain-only checkpoint. Within
the reviewed process-crash boundary, it durably fixes one exact Python/Linux
host-generation intent and converges its bounded member set through repeatable
Nix indirect-root requests. It does not prove exact daemon registration,
acquire or retire a generation, authorize execution, or make any recipe
`READY`.

For this boundary, this review supersedes the passive-root verification,
canary, acquisition, and retirement design in
[review 122](122-private-indirect-gc-root-feasibility.md). That review remains
useful feasibility history. The implemented boundary is deliberately smaller.

## 1. Corrected Nix evidence

The same-path host probe established that an indirect root requested through:

```text
nix-store --add-root <absolute-jig-owned-path> --indirect \
  -r <exact-store-member>
```

is an ordinary symlink at the requested path. Subsequent adversarial
measurement established the important limits:

| Operation | Measured behavior | Consequence |
|---|---|---|
| Re-add an exact registered or unregistered symlink | succeeds and replaces the symlink inode | no stable inode or identity pin crosses the call |
| Add over a wrong-target symlink | succeeds and replaces it | the CLI is not a no-replace comparison-and-swap |
| Add over an ordinary file or directory | fails and preserves the entry | Jig can fail closed on non-link collisions |
| Concurrent adds for different targets at one path | both may succeed; the last writer wins | absence checks cannot serialize publication |
| Query `--roots` for a target | may print the requested `path -> target` relation | the answer is transitive, visibility-filtered, and may prune stale roots, so it is not a passive exact-root proof |

Global live/dead queries establish reachability, not which configured path
provides it. The private protocol therefore has no passive verifier and never
branches on a claim that a root is already registered. It repeats the one
permitted same-path/same-target effect instead.

## 2. Implemented retain-only protocol

The protected state contains exactly:

```text
<state-root>/
├── private-python-linux-roots-v1.sqlite3
└── runtime-roots/
    └── <generation-digest>/
        ├── member-0000 -> /nix/store/...
        └── ...
```

There is no `registration.json` inside this converger-owned state, completion
bit, active head, lease table, or retirement record. The later host-policy
observer uses a separate root-installed registration boundary.

The state root must already exist as one canonical, owner-only mode `0700`
directory. Its SQLite database is one owner-only, single-link mode `0600`
file on the same filesystem. The database uses an exact versioned schema,
DELETE journaling, `synchronous=EXTRA`, and a single immutable row containing
the canonical generation bytes and digest.

Publication is ordered as follows:

1. Require and freshly verify an authentic observed eight-role generation.
2. In `BEGIN IMMEDIATE`, insert its canonical bytes into the empty singleton,
   or require byte-for-byte equality with the existing singleton. Commit this
   intent before any Nix root effect.
3. On convergence, strictly decode the stored inert value and independently
   reobserve every protected role and bounded member closure. Decoding does
   not recreate authenticity.
4. Reacquire the descriptor-confined state tree. Require the deterministic
   generation directory to contain only the expected indexed members.
5. Materialize the complete local member-link set before the first Nix call.
   Preserve and reject every wrong target, wrong type, foreign entry, unsafe
   identity, or unsafe database sidecar.
6. For every member, unconditionally invoke the exact observed `nix-store`
   with `argv0` fixed to `nix-store`, cwd `/`, an empty environment, daemon
   store selection, and substitution and fallback disabled. Output and time
   are bounded.
7. Before and after every invocation, revalidate the descriptor-backed
   directories and freshly inspect the complete exact same-target link set. A
   changed link inode is expected; a changed target is not.
8. After the final request, freshly reverify all generation roles and closure
   count/digests, the immutable SQLite row, and the complete local tree.

The only legitimate target for each deterministic path is fixed by durable
canonical intent before step 6. There is no production unlink, rollback,
replacement, deletion, or cleanup operation.

## 3. Concurrency and crash semantics

SQLite serializes competing **intent writers**, not all root subprocesses.
The first exact generation becomes the immutable singleton. Repeating the same
generation is idempotent; a different generation is rejected or observes a
bounded busy result. This prevents the private implementation from growing an
unowned sequence of generations.

Same-generation convergers may overlap. That is safe within the cooperative
host boundary because they derive the same bounded path/target set and issue
only the same commutative replacement effect. A Nix client that outlives its
coordinator may also finish late, but it can restore only the same target.
The protocol does not claim to serialize, cancel, or identify that escaped
client.

Recovery is replay rather than rollback:

| Interruption | Durable/recoverable state |
|---|---|
| Before singleton commit | no protocol-issued root effect is possible |
| Commit acknowledged late or coordinator exits after commit | the exact singleton is safely restaged and reread |
| During local link materialization | an exact partial prefix is completed; foreign state is preserved and rejected |
| During the Nix loop or after acknowledgement loss | some same-target requests may have happened; every member is re-added |
| After all requests but before return | there is no completion receipt; a fresh convergence repeats all effects |
| SQLite writer killed with a hot journal | SQLite recovery must restore the exact immutable singleton before convergence |

Failures can therefore leave a bounded replayable root leak, never deletion
authority or an admitted unrooted generation. This is a process-crash claim
for the reviewed cooperative same-user, local-filesystem environment. The Nix
interface provides no acknowledgement that its collector-side parent was
fsynced, so this checkpoint makes no arbitrary-power-loss claim.

## 4. Host corpus

The dedicated host corpus proves:

- durable, idempotent staging and repeated convergence from the current and a
  fresh coordinator process;
- one immutable winner under competing generation writers;
- concurrent same-generation convergence attempts followed by stable replay;
- recovery from a deterministic partially materialized local prefix;
- recovery while an exact same-target Nix client survives coordinator
  `SIGKILL` and completes later;
- preservation and fail-closed rejection of wrong-target and hard-linked
  symlinks, ordinary files, and unexpected entries before any Nix effect;
- rejection of unsafe database permissions, hard links, WAL state, schema
  identity drift, and a digest inconsistent with canonical row bytes;
- zero root effects from a committed schema with no intent, hot-journal
  recovery after killed existing-row and first-insert writers; and
- restoration of the test state-parent baseline with no surviving fixture
  process or test root tree.

The corpus uses real emitted generation artifacts, protected host files,
SQLite, and process failures. For root side effects it uses a bounded,
Nix-store-resident test executable that records the exact argv, empty
environment, cwd, and interleavings while emulating the measured symlink
replacement behavior. The separate real-Nix probe supplies the feasibility
measurements in §1. The corpus does **not** prove that the active daemon can
dereference this configured state root or that its collector retains these
members.

## 5. Exact evidence and nonclaims

A successful call returns a process-local branded value with:

```text
kind: python-linux-root-convergence/1
admissible: false
generation digest
state-root path
exact local root path/target pairs
```

It proves only that this process read the immutable intent, freshly verified
the protected generation, successfully requested every expected effect, and
revalidated the complete exact local tree before returning. The brand cannot
be reconstructed by decoding or object copying and is not persisted.

It does not prove:

- passive or exact collector enumeration;
- same-path daemon reachability for the configured root;
- survival across arbitrary host power loss;
- production selection or acquisition of the separately observed host policy;
- acquisition, lease, active ownership, or restart fencing;
- no-new-acquisition retirement or safe root deletion;
- restricted privileged launch or active Backend readiness;
- lock-first admission or execution authorization; or
- protection against a malicious peer with the same host identity.

The module is private. No convergence result is a public SDK value, durable
receipt, capability, grant, admission record, or `READY` evidence.

## 6. Remaining `READY` gates

Before this stored intent may support execution, Jig still needs:

1. trusted host bootstrap/configuration for the strict registration observer's
   anchor identity and expected digest plus qualifying exact same-path daemon
   reachability;
2. a restricted root-owned launcher that authenticates one lock-first,
   one-shot admitted spawn plan and itself supplies the fixed registration
   selection, never caller-selected helper paths or raw arguments;
3. one durable acquisition/recovery transaction that freshly observes the
   registration, reconverges and reverifies the exact generation, and runs the
   active Backend preflight before package code;
4. durable coordinator epoch, spawn intent, cgroup ownership, and
   a kernel-released per-spawn recovery fence;
5. restart reconciliation before execution backing can be released;
6. a later no-new-acquisition retirement and exact deletion protocol, with no
   removal authority inferred from inert generation bytes alone; and
7. exact post-lock reverification within that one admitted spawn transaction.

Arbitrary-power-loss retention requires a separately justified registrar or
equivalent acknowledgement boundary if it becomes a product requirement.
Until the listed gates are implemented and hostile-tested, the Python/Linux
candidate remains `UNAVAILABLE`.

The strict, still non-admissible observation mechanism used by items 1 and 3
is implemented by
[review 128](128-private-host-registration-observation.md). That checkpoint
does not supply the production trust source, launcher, or acquisition and
therefore does not change this `UNAVAILABLE` conclusion.
