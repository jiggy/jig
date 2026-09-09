---
title: Results and recovery
---

# Results and recovery

Jig reports execution status separately from the method's application outcome.
Use both to decide what happened and whether another action is appropriate.
For your first successful invocation, start with [the quickstart](./index.md).

## Read results and diagnose failures

`jig <command> --help` explains that command's options and examples. Invalid
syntax is diagnosed even when the host cannot execute Runs. Errors identify a
relevant project-relative location where available and suggest a safe next step.
A missing target lists targets from the approved revision; Jig never picks one
for you.

Stdout contains the JSON result, or NDJSON when `--receive` is selected. Stderr
carries diagnostics and, on a terminal, elapsed status and cancellation updates.
Piped stdout remains machine-readable. No spinner or terminal control codes are
required. Ctrl-C requests cancellation; wait for cleanup before starting new
work. An interruption or uncertain result is not permission to blindly retry.
An interrupted command may exit without a JSON result; scripts must check the
exit status and handle an absent terminal value.

A protocol error means the Flow did not complete Run/1 correctly. Check its
SDK revision and stdout use, then inspect the result and any effects before
running again. After changing source or dependencies, review the changes first.

Execution completion is different from task success: a method can execute
correctly and return an application outcome such as `blocked`. Inspect the
outcome, output, and exit status. With `--out`, also inspect the separate
delivery status. Existing output directories are never replaced; choose a new
destination for another Run.

## If retained state cannot be opened

`PROJECT_STATE_INVALID` means `.jig` is incompatible with the current build or
damaged. Reinstalling dependencies does not change that state. Preserve `.jig`
and `jig.lock` for recovery; once prior work is confirmed stopped and cleaned up,
move them outside the project and run `jig review` for fresh approval. Keep the
source and dependency locks. If cleanup is uncertain, recover the owned work
before replacing its state.
