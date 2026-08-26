# Private retained runtime-support observation

**Status:** implemented private checkpoint. It proves the first retained
author-evaluator step in review 130; it does not publish a Runtime Adapter,
Sandbox Backend, runtime-store, lease, or Nix interface.

## 1. Host boundary

The `firecracker-host` proof environment now owns one lease for the lifetime
of its outer sandbox. The host creates and removes its own Nix GC roots and
mounts only read-only receipts into the sandbox. Helper expiry and Jig
coordinator restart do not end that lease. Jig and package code receive no
root-management operation, writable collector state, Nix daemon authority, or
additional sudo authority from this mechanism.

The sandbox implementation was supplied independently in:

```text
573f9ff  Add sandbox-scoped runtime leases
6a2ac6d  Document runtime lease guarantees
```

Its remaining deployment-level check is an isolated live-GC exercise followed
by teardown collection. Jig does not run a host-global garbage collector to
perform that check.

## 2. Private Jig observation

`agent-sandbox-runtime-support.ts` is one deliberately host-specific input
adapter. It:

1. accepts the receipt directory, expected lease ID, and selected executable
   only from trusted proof-host configuration;
2. requires the receipt directory and selected support paths to be covered by
   read-only mounts;
3. parses bounded JSON/1 lease and rootfs receipts;
4. requires matching sandbox-lifetime ownership and lease identity;
5. finds the closure member containing the exact executable and follows only
   receipt-declared references;
6. canonicalizes and rechecks every selected support path;
7. fingerprints the executable and complete receipt; and
8. returns one process-authenticated immutable observation.

The observer neither invokes Nix nor knows how the host retains a path. Nix
store paths remain physical proof-host facts. No Nix prefix, root, daemon,
installable, or GC operation enters the evaluator contract.

The private author evaluator now consumes that authenticated observation. Its
mount set must exactly equal the observed transitive support set, preserve the
runtime's absolute paths, contain the executable, and still match the
executable digest immediately before launch. Its local profile records the
lease and receipt identities. These host-local facts remain excluded from the
portable project lock.

## 3. Evidence

The deployed sandbox proved:

- a unique lease and read-only receipt mount;
- exact lease agreement among the rootfs and injected-output receipts;
- Bun, Bash, and Bubblewrap membership in the retained rootfs closure;
- execution of a newly injected tool after the materializer helper exited;
- fail-closed launch for a mismatched lease or missing receipt directory; and
- no write access to the receipt files.

The Jig checkpoint additionally proved:

- identical runtime-support observations from two fresh coordinator
  processes;
- rejection of a mismatched lease in a fresh process;
- the real bounded project evaluator using only receipt-derived support
  mounts;
- one complete retained package project through that evaluator; and
- all cgroup-v2 hostile cases with no residual Jig cgroups.

Validation on 2026-08-26:

```text
ordinary Jig suite       306 pass, 13 proof-host cases skipped, 0 fail
Linux proof-host suite    13 pass, 0 fail
Jig cgroup residue         0
```

The ordinary suite selected the injected Python receipt's exact `bin_path` in
the test-runner `PATH`. The generated `need` launcher is a development
convenience which requires its lease environment and is not a package runtime
or clean-environment launch mechanism.

## 4. Deliberate limits

This checkpoint does not prove:

- a generic runtime artefact format or installation protocol;
- public Adapter or Backend registration;
- that a package may select or manage a runtime lease;
- project Nix environment support;
- a retained executable recipe for a Flow;
- narrow production installation of the privileged Linux helper; or
- Bun suitability for a general `READY` recipe.

Bun's descendant mapping failure remains a successful negative gate. The
author evaluator is a root-only bounded host operation; that does not qualify
Bun for general Flow execution or justify broader `/proc` or `/dev` access.

## 5. Next checkpoint

The next step is deterministic private selection of one explicitly configured
Python runtime support observation and the existing Linux Backend for one
zero-configuration `flow.py` Run package. It may create one retained `READY`
candidate beside the already implemented exact `UNAVAILABLE` candidate only
after the complete recipe can be reacquired from protected host policy.

The runtime lease remains an external input to that recipe. Jig must not
materialize it, extend its lifetime, or infer readiness from ambient `PATH`.
The host launcher/helper installation and durable spawn lifecycle remain
separate gates later in the same vertical slice.
