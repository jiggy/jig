# Private privileged-helper startup posture checkpoint

**Status:** implemented and hostile-tested private startup checkpoint. It
closes ambient environment, working-directory, Bun-policy, generic-shell, and
duplicate-control-flag inputs for the current helper launch. It does not
authorize the launcher, authenticate a retained generation, produce an active
preflight receipt, or make any recipe `READY`.

## 1. Exact startup chain

The coordinator now executes this fixed chain:

```text
exact observed sudo
  -n --
  exact observed Bash
    --noprofile --norc -p
    -c 'cd -- / && exec -c -- "$@"'
    jig-cgroup-helper
    exact observed Bun
      --no-env-file
      --no-install
      --config=/dev/null
      exact observed helper
      <helper control arguments>
```

The coordinator spawns sudo with cwd `/` and an empty input environment. Sudo
may construct its own root environment, so that alone is not the security
boundary. Privileged Bash runs one constant program, treats every dynamic
value only as a positional argument, changes to `/`, and uses `exec -c` to give
Bun an actually empty environment.

`-p` is required in addition to `--noprofile --norc`: a measured hostile
`BASH_ENV` executed before the fixed command without `-p`, while privileged
mode ignored it. Bun then disables env-file loading, package installation, and
host/project configuration before loading the helper.

The Backend no longer accepts a generic optional `shellPath` or defaults to
`/bin/sh`. It requires one exact `bashPath`, includes the resolved Bash path and
digest in its private mechanism observation, and uses that same Bash for both
the startup bridge and cgroup-entry trampoline. This avoids silently depending
on an unobserved `/bin/sh` wrapper or on a shell without Bash semantics.

## 2. Helper self-verification

Before parsing caller arguments, connecting to the coordinator, or creating a
cgroup, the root helper now requires:

```text
real uid 0
cwd exactly /
no environment entries
process.execArgv exactly:
  --no-env-file
  --no-install
  --config=/dev/null
```

Its named control grammar is closed. Unknown names and duplicate names fail
before any required-field lookup. The `--` separator remains mandatory before
the existing private Bubblewrap argument sequence. The cgroup-entry Bash is
also invoked with no startup files, privileged mode, cwd `/`, and an empty
environment.

These checks make accidental or alternate helper invocation fail closed. They
do not authenticate who selected the helper, Bash, Bubblewrap, scope, or raw
Bubblewrap plan.

## 3. Measured evidence

The host probe first showed why the change was necessary: sudo synthesized
`HOME`, `PATH`, `SUDO_*`, and other root values even when its parent received
an empty environment. The exact Bash bridge then produced root Bun with cwd
`/`, an empty `process.env`, and the three exact policy arguments.

Hostile negative tests prove:

- direct sudo-to-Bun launch is rejected for ambient environment;
- a missing Bun policy flag is rejected; and
- duplicate helper control fields are rejected.

At this checkpoint, the complete Linux hostile matrix passed through the
changed bridge and trampoline:

```text
14 tests
hostile expect calls all satisfied
0 failures
```

That matrix includes PID storms, aggregate memory exhaustion, CPU throttling
and accounting independently from hard wall termination, startup/shutdown
cancellation, orphan/grandchild cleanup,
coordinator death, repeated Runs, the negative general-Bun-Run descendant gate,
project evaluation,
retained package resolution, an exact Python Run/1 invocation, and a Python
Service/1 Mount. The preflight reported cgroup v2 plus cpu/memory/pids controls,
KVM and TUN separately available, and all test cgroups removed.

The current main-branch proof-host corpus is smaller: the exact Python Run and
Service witnesses moved with the Nix-retention experiment to
`experiments/nix-runtime-retention`. Review 105 lists the twelve cases retained
on main. This dated result remains evidence for the helper change, not the
current test manifest.

## 4. Exact non-claim

This is a closed-startup proof, not a qualifying privileged launcher. The
development host currently permits broad passwordless sudo. An untrusted Flow
cannot see that executable inside the Bubblewrap envelope, but the host policy
still does not restrict sudo itself to the registered Jig launcher/helper.

The current helper protocol also still receives coordinator-selected paths and
a raw private Bubblewrap argument sequence. The default development helper may
come from the checkout. The mechanism digest still combines stable executable
identity with volatile cgroup-scope facts. None of those facts may be certified
away by this checkpoint.

Therefore it adds no:

- administrator-owned restricted launcher;
- authenticated host-generation or host-policy registration;
- durable authenticated host-runtime acquisition;
- stable mechanism pin or volatile active-preflight capability;
- persisted spawn owner, coordinator epoch, recovery lock, or restart fence;
- public Backend, launcher, receipt, or sandbox interface; or
- `READY` candidate or admission evidence.

## 5. Current disposition

A later Nix-specific experiment tried to retain the proof host's exact Bash,
Bun, helper, Bubblewrap, and other store members. That work is preserved on
`experiments/nix-runtime-retention`, not on the current implementation path.
It did not turn this helper into a production launcher or qualify `READY`.

The generic successor still needs a narrowly authorized, durably installed
host entrypoint which accepts only one authenticated closed plan from one
explicitly registered Runtime Adapter and Sandbox Backend selection. Its active
preflight must run a fixed package-free canary, prove live controller readback,
payload identity and cgroup invisibility, terminal fencing, helper exit, and
zero residue, and remain bound to the admitted recipe and coordinator epoch. A
checkout-based or broad-sudo preflight cannot qualify `READY`. See the current
roadmap in
[`130-nix-experiment-disposition-and-next-slice.md`](130-nix-experiment-disposition-and-next-slice.md).
