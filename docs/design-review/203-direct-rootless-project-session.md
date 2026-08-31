# Direct rootless Project Session

**Status:** completed on 2026-08-31 for Goal G3.

## Result

One finite descriptor-held Project Session now proves the complete direct Bun
path through the canonical rootless mechanism:

```text
local project
    -> reviewed retained Plan
    -> explicit apply
    -> exact admitted direct Flow
    -> validated Run/1 terminal
    -> session close and complete cleanup
```

The campaign deliberately contains one zero-configuration Bun Flow and no
child Flows, Services, Journal, Hooks, Agents, or semantic selection. Its FLOW
SDK sources are ordinary package-local relative imports, so the proof needs no
Python runtime or native package preparation.

## Safety evidence

The hostile campaign passes three tests and 37 assertions. It proves:

- applying retained reviewed bytes after visible source changes;
- one schema-valid successful direct Run;
- exact submission replay returning the same Run and terminal;
- changed reuse returning `SUBMISSION_CONFLICT` without another Run;
- close-driven cancellation and revocation of escaped Root Administration;
- reopen observing the durable cancelled terminal;
- complete coordinator loss settling as `COORDINATOR_LOST` only after fencing;
- replay after coordinator loss without another dispatch or lifecycle row;
- project-owner release and subsequent reacquisition; and
- no new Run cgroups, control directories, owner directories, or private
  device directories.

The deterministic Project Session owner/controller suites remain responsible
for path substitution, exclusive acquisition, and close linearization. The
rootless Backend hostile suite remains responsible for descendant, resource,
deadline, and cleanup mechanics. This campaign does not duplicate them.

## Boundary

Run replay is the G3 replay guarantee. Repeating `plan` for unchanged visible
source was not stable in the transient per-command proof host: observed runs
either produced a different Plan digest or a sanitized `UNAVAILABLE`. That is
not hidden as a passing claim. It must be resolved if the installed `check` /
`run` workflow in Goals G5 and G6 depends on lost-response Plan convergence.

This checkpoint creates no public Project Session constructor or host SPI.
