# Private foreground dogfood

**Status:** closed on 2026-08-27. This checkpoint adds one repository-only
operator-shaped path over the already proved private admission and execution
machinery. It publishes no CLI, project-opening, Runtime Adapter, Sandbox
Backend, or administration interface.

## 1. Purpose

The direct-root and deterministic-child slices were executable only from
integration-test orchestration. Their mechanisms were real, but they did not
yet answer whether one person could point the retained system at one ordinary
project, review its exact plan, and then run it in a fresh process.

The private foreground driver closes only that usability gap:

```text
real jig.ts project
    -> private plan process
    -> retained packages and exact READY recipes
    -> durable review plan
    -> explicit apply in a second process
    -> direct Python root Run
    -> bound Bun parent -> exact Python child Run
    -> durable terminal status and complete cleanup
```

## 2. Deliberately private interface

`packages/jig/scripts/private-foreground.ts` lives outside `src/`, is excluded
from the packed package, and is not wired to the installed `jig` binary. It has
two proof-host-only commands:

```text
plan <project-root>

apply-run <project-root>
  --plan <reviewed-digest>
  --base <reviewed-generation|null>
  --yes
  --request <Root-Administration-start-value>...
```

`plan` captures and retains the project, requires every discovered Run target
to have one exact private Bun or Python recipe, publishes the private candidate,
and returns the exact review pair and target evidence. `apply-run` consumes
that pair without re-evaluating visible source, then uses the existing private
Root Administration controller to submit and drain the requested Runs.

The spelling above is disposable test ergonomics. It is not evidence for a
public command, stable JSON output, project handle, authentication model, or
general host policy API.

## 3. Proof project

The focused project intentionally has only two admitted targets:

- a zero-configuration Python direct Flow; and
- one Bun package Binding whose required settings and exact `child` slot make
  the underlying package ineligible as a hidden direct target.

The test runs the plan and apply phases in separate processes and mutates the
visible child implementation after planning. Both the direct and composed Run
still execute the retained reviewed bytes, proving that apply does not reopen
the project tree.

## 4. Host boundary

This driver is explicitly coupled to the current proof host. It authenticates
the sandbox-lifetime Bun and Python support receipts and constructs the single
private Linux cgroup-v2/Bubblewrap Backend. It neither discovers ambient
runtimes nor manages the proof host's package manager or lease lifecycle.

Missing receipts, cgroup delegation, trusted launcher paths, or exact recipes
fail the command. No weaker fallback exists.

## 5. Evidence and limits

The focused hostile proof covers separate plan/apply processes, direct and
composed cross-language execution, retained-source behavior, explicit apply
approval, and zero residual Jig cgroups or private device directories. The
larger hostile corpus remains authoritative for cancellation, coordinator
loss, fencing, and cleanup races; this test does not duplicate it.

Still absent are a public project-opening boundary, authenticated transport,
plan/apply schemas, stable error and exit models, generic runtime or sandbox
registration, dependency preparation, and a supported CLI. The private
foreground path is dogfood evidence, not a release-surface shortcut.
