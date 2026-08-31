# Compiled Bun runtime feasibility

**Status:** private feasibility proof completed on 2026-08-31. This selects one
built-in Bun recipe for the first alpha. It does not yet select the physical
release layout or close the admitted rootless Project Session join.

## Question

Can an installed Jig carry the exact Bun runtime needed by TypeScript FLOW
packages without a host Bun registration, ambient `PATH`, runtime registry,
package-manager integration, or `jig setup`?

## Result

Yes. Bun standalone executables can act as the Bun CLI when invoked with
`BUN_BE_BUN=1`. A compiled Jig artifact was mounted read-only inside an
otherwise empty Bubblewrap namespace and used as `/jig` to execute a real
Run/1 TypeScript FLOW package. The package imported the real FLOW SDK,
completed one request, and spawned a descendant through `process.execPath`.
Both parent and descendant reported the exact embedded Bun version. No ambient
Bun executable was mounted or searched.

The executable is dynamically linked. The proof mounted exactly its ELF
loader and four required C-library objects read-only. This is a finite support
closure, not a claim that the executable is statically linked or literally one
filesystem object at runtime.

The selected semantic boundary is therefore:

> The first Jig release owns one exact built-in Bun recipe.

Using the same physical executable for Jig and Bun is the smallest proven
packaging candidate, not portable FLOW vocabulary and not yet an immutable
architecture rule. An adjacent release-owned Bun executable remains possible
if later least-privilege evidence rejects same-file reuse.

## Security boundary

The compiled artifact normally enters its baked Jig CLI. Only the trusted
inner launch path sets `BUN_BE_BUN=1` for an already admitted TypeScript
component. It also supplies the fixed no-autoload policy:

```text
--no-env-file --no-install --config=/dev/null
```

A component can unset `BUN_BE_BUN` and invoke the Jig application visible in
the same file. That must grant no additional authority: the sandbox contains
no project controller, cgroupfs, Bubblewrap, host sockets, credentials,
privileged file descriptors, or mutable Jig state. This invariant must be
tested as the CLI grows.

Artifact and support-library identity remain internal planning and receipt
facts. FLOW metadata gains no runtime field, version, command, or digest.

## Proof and remaining gates

The automated proof passes one real Run/1 exchange and descendant execution.
It also rejects an unexpected ELF interpreter before package launch and mounts
only the explicit executable, C-library closure, package, SDK, procfs, private
devices, and scratch filesystems.

The rootless product join must still prove all of the following together:

- compile the release artifact in a controlled Linux target environment;
- dispatch coordinator, supervisor, entry, and inner work as private modes of
  installed release bytes rather than source-module paths;
- retain and revalidate the exact executable and support closure across one
  Run;
- fail before package execution when any member is missing or changed;
- run real author evaluation and the one admitted native-preparation shape;
- preserve limits, deadlines, cancellation, coordinator-loss recovery,
  fencing, and zero residue; and
- prevent an installed-file unlink or replacement from substituting another
  runtime for an already admitted Run.

Bubblewrap and delegated cgroup authority are separate operating-system
prerequisites. This result removes only ambient Bun acquisition. A host with no
inherited or manager-created delegation still returns `SANDBOX_UNAVAILABLE`.

## Non-decisions

This checkpoint creates no public Runtime Adapter, Sandbox Backend, runtime
registry, host registration, package-manager ownership, secondary lock, or
FLOW runtime profile.
