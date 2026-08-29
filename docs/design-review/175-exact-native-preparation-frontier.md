# Exact native dependency preparation frontier

**Status:** selected on 2026-08-29 after the clean-room Project Authoring
campaign exposed the missing SDK installations and an adversarial comparison
of native installers versus a Jig-owned archive extractor. No preparation
implementation is claimed by this record. The subsequent
[artifact-boundary review](179-native-preparation-artifact-boundary.md) rejects
caller-asserted archive evidence and records the exact host-owned substrate
required before this implementation may begin.

## 1. The exact gap

The authored Bun reviewer declares exact `@flowmd/sdk@0.0.0`; the Python
normalizer declares exact `flowmd-sdk==0.0.0` and Python
`>=3.14,<3.15`. Both components pass as ordinary Run/1 processes only when the
campaign evaluator installs those dependencies outside Jig. Current direct
recipes materialize the authored Package/1 unchanged and deliberately disable
ambient installation or lookup, so the same components cannot yet execute
through the Jig host.

This is a native preparation gap. It is not a reason to vendor the SDKs into
the subject, mount dependencies as Runtime Support Closure, add `NODE_PATH` or
`PYTHONPATH`, consult a registry, or broaden FLOW metadata.

## 2. Rejected design: a Jig-owned two-format extractor

A fixed Python worker which manually extracts the npm tarball and wheel is
rejected as product architecture. It would make Bun preparation depend on
Python and make Jig responsible for evolving npm and wheel installation
semantics: archive roots, collisions, links, wheel tags, `WHEEL`, `RECORD`,
`.data`, scripts, installed-distribution metadata, and future format behavior.
Safe-tree validation is still required afterward, so this does not remove the
security boundary.

Most importantly, its output must not be called Package/1:

```text
Package/1
    exact immutable authored source identity

private prepared tree
    source plus generated native runtime material
```

Reusing the Package/1 identity domain for both would conflate source,
provenance, review, schema admission, and execution backing.

## 3. Selected mechanism

Jig coordinates one exact native installer inside a distinct Sandbox Backend
owner. It does not implement dependency resolution.

The first slice supports only:

```text
one exact Bun Package/1 fixture
    declaring @flowmd/sdk at one exact version

one exact authenticated retained SDK tarball

one fixed offline, networkless, script-free Bun install

one immutable private prepared-tree artifact

one final Run/1 process launched read-only with --no-install
```

The host supplies the installer through exact authenticated runtime support.
Protected planning constructs a synthetic one-dependency manifest pointing at
the retained local tarball and invokes Bun with fixed no-save, ignore-scripts,
empty-cache, copyfile, and no-config policy. The installer receives an empty
environment, no network, no ambient cache or home, no package registry, no
project tree, no attachments, no effects, no secrets, and no Run/1 channel.

If that passes, the second slice may add the exact pure Python wheel using
authenticated pip with isolated, no-index, no-deps, no-cache, no-compile, and
fixed-target policy. There is no sdist, build backend, transitive resolution,
index lookup, or manual-extractor fallback.

## 4. Preparation is a durable child owner

Preparation may execute package-controlled archive and installer behavior. It
cannot be a synchronous helper hidden inside recipe planning. Its minimum
lifecycle is:

```text
durable preparation allocation and spawn intent
    -> separate bounded cgroup/Backend envelope
    -> possible dispatch recorded before installer execution
    -> installer settlement
    -> complete descendant-tree fence and populated 0
    -> safe-tree capture and validation
    -> immutable private prepared-tree publication
    -> owner release and closure
    -> final Run launch from the read-only retained tree
```

Root cancellation and deadline bound the subordinate owner. Coordinator loss
after possible dispatch fences it and settles conservatively without another
installation attempt. Cleanup ownership must remove its cgroup, writable
staging, scratch, and temporary devices even when the coordinator disappears.

Inputs are read-only. Output is accepted only after complete-tree fencing and
must contain byte-identical source plus the one exact allowed dependency
subtree. Symlinks, hardlinks, special files, unsafe paths, unexpected output,
replacement races, or material variance between identical exact inputs reject
the preparation.

This does not create a generic scheduler or public child-owner API. The first
implementation is one private subordinate lifecycle for one root preparation.

## 5. Identity and admission

The authored `request.package` remains the source identity used for project
lock, provenance, input/result schemas, declared outcomes, and result
admission. Final execution uses a separate private prepared-tree reference.

The portable lock and Candidate/5 grammar need not change for this exact
private proof. The candidate value must change: its ready recipe and
observation commit the exact dependency artifact, installer/runtime identity,
preparation plan, Backend/envelope identity, and non-null preparation plan and
envelope digests. That changes activation meaning, Candidate digest, Plan, and
admitted generation in the ordinary way.

The produced prepared-tree digest is execution-time evidence. It belongs in
the durable preparation result/backing, not retroactively in Package/1 or the
portable lock. Execution/recovery may reopen only a completed authenticated
preparation result; it never starts preparation while reproducing an admitted
root after uncertain dispatch.

The source subjects have exact version declarations but no native lockfiles.
An exact operator-supplied artifact can support this one private proof, but it
does not prove portable dependency locking or justify a public Lock/1
conclusion.

## 6. Implementation sequence

1. Retain and authenticate the exact Bun SDK tarball and recognize only the
   campaign's exact manifest shape; every other shape is unavailable.
2. Define a distinct bounded immutable private prepared-tree artifact/store,
   never a second Package/1 interpretation.
3. Prove one ephemeral offline/script-free Bun install and safe-tree capture
   inside the existing Backend.
4. Add durable preparation intent, possible-dispatch, fencing, result,
   release, closure, recovery, and no-redispatch ownership.
5. Commit non-null preparation evidence into the Bun recipe and Project
   Session planning path, then execute the prepared reviewer.
6. Add the exact Python wheel only under the same contract and run the real
   reviewer-to-normalizer call.
7. Close cancellation, deadline, coordinator-loss, deterministic-output,
   repeated-run residue, artifact drift, and hostile archive cases.

## 7. Stop conditions

Stop rather than broaden if:

- the artifact or installer is not authenticated, retained, and reacquirable;
- the installer consults network, registry, ambient cache/configuration, or
  executes scripts;
- Python would require an sdist/build backend or unauthenticated pip;
- output needs unsafe links, special files, mutable runtime state, or broad
  host visibility;
- coordinator loss cannot fence the preparation without redispatch;
- identical exact inputs produce materially different prepared trees; or
- progress requires a registry, solver, cache lifecycle, generic Adapter or
  Backend SPI, FLOW runtime/dependency metadata, or Nix/package-manager
  lifecycle ownership.

The first earned claim is intentionally only:

> Jig can securely prepare and execute one exact first-party SDK dependency
> using its native installer.

It is not a general dependency manager.
