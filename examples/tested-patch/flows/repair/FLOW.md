---
name: project-repair
description: Propose a bounded multi-file repair and check the exact candidate through reviewed Bun commands.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
  command:
    contract: ./contracts/project-command.capability.json
outcomes:
  blocked: Independent cases did not reproduce the defect, or neither proposal passed.
  limit: The Agent stopped at its limit.
---

This reusable leaf takes `issue`, a `files` map of paths to text, selected
`editPaths`, and independently authored CLI `cases`. Each case supplies an
`id`, `args`, `stdin`, expected `stdout`, `stderr`, and `exitCode`. It accepts
16 files totaling 64 KiB, up to eight editable source paths, and eight cases.
There are no attachments or child Flows.

The operator binds `tests` to reviewed Bun test paths and `cli` to the project
entrypoint. The method first runs the original tests and CLI cases. A concrete
acceptance mismatch allows an Agent proposal of replacement text, never shell
commands. An invalid proposal or failed candidate earns one correction, for a
maximum of two Agent calls. Every proposal remains relative to the original.

Jig executes immutable candidate contents in a separate, credential-free
scope and collects output and termination outside that scope. Ordinary tests
are useful but candidate code can interfere with their runner. This method
compares captured CLI behavior with its unchanged expected values without
importing candidate code or reading a candidate-authored pass flag.

The result retains original and candidate identities, validated replacement
text, command evidence, and independent acceptance decisions. `done` requires
both reproduced failure and a passing candidate. Passing finite checks does
not establish general correctness. Cancellation, deadlines, uncertainty, and
unavailable support propagate without correction or replay; earlier evidence
is retained in operation details when a terminal remains deliverable.
