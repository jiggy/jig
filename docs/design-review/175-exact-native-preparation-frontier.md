# Exact native dependency preparation frontier

**Status:** selected on 2026-08-29 after the clean-room Project Authoring
campaign exposed the missing SDK installations and an adversarial comparison
of native installers versus a Jig-owned archive extractor. No preparation
implementation is claimed by this record. Review 179 correctly rejects
caller-asserted archive evidence but assigns dependency custody to the wrong
owner. The
[package-local correction](186-package-local-native-artifact-correction.md)
supersedes that external blocker and fixes the input to this implementation.

## 1. The exact gap

The authored Bun reviewer declares exact `@flowmd/sdk@0.0.0`; the Python
normalizer declares exact `flowmd-sdk==0.0.0` and Python
`>=3.14,<3.15`. Both components pass as ordinary Run/1 processes only when the
campaign evaluator installs those dependencies outside Jig. Current direct
recipes materialize the authored Package/1 unchanged and deliberately disable
ambient installation or lookup, so the same components cannot yet execute
through the Jig host.

This is a native preparation gap. It is not a reason to mount dependencies as
Runtime Support Closure, add `NODE_PATH` or `PYTHONPATH`, consult an ambient
registry, or broaden FLOW metadata. The corrected first offline proof may use
one exact package-local archive as ordinary native input; that is a bounded
pre-publication fixture rather than a new FLOW convention.

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
    declaring one relative package-local @flowmd/sdk archive

one exact SDK tarball identified inside Package/1 and retained by its
protected PackageArtifact owner

one fixed offline, networkless, script-free Bun install

one immutable private prepared-tree artifact

one final Run/1 process launched read-only with --no-install
```

The host supplies only the installer and runtime through exact authenticated
runtime support. Protected planning derives a synthetic one-dependency
manifest from the retained native declaration and its relative archive member,
then invokes Bun with fixed no-save, ignore-scripts, empty-cache, copyfile, and
no-config policy. The installer receives the immutable source and dependency
member, an empty environment, no network, no ambient cache or home, no package
registry, no project tree, no attachments, no effects, no secrets, and no
Run/1 channel.

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
observation commit the exact derived dependency member, installer/runtime identity,
preparation plan, Backend/envelope identity, and non-null preparation plan and
envelope digests. That changes activation meaning, Candidate digest, Plan, and
admitted generation in the ordinary way.

The produced prepared-tree digest is execution-time evidence. It belongs in
the durable preparation result/backing, not retroactively in Package/1 or the
portable lock. Execution/recovery may reopen only a completed authenticated
preparation result; it never starts preparation while reproducing an admitted
root after uncertain dispatch.

The corrected source subject uses one exact relative local dependency but no
general registry lock. This supports one private offline proof; it does not
prove portable dependency locking or justify a public Lock/1 conclusion.

## 6. Implementation sequence

1. Recognize only one retained package whose exact native declaration points
   to one relative SDK tarball member; derive the dependency key, normalized
   member path, member digest and installer inputs from the same Package/1
   bytes. Do not host-parse npm tar metadata. Every other shape is unavailable.
2. Prove one ephemeral offline/script-free Bun install inside the existing
   Backend, then validate its installed identity and bounded safe output after
   complete-tree fencing. Output bytes may be buffered by the trusted helper
   while the process runs, but cannot be accepted or published before fencing.
3. Define a distinct bounded immutable private prepared-tree artifact/store,
   never a second Package/1 interpretation.
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

- the dependency member is not captured, retained, and reacquirable with its
  Package/1, or the installer/runtime is not authenticated host machinery;
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
