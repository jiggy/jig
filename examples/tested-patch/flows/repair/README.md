# project-repair

This reusable specialist takes `issue`, a `files` map of paths to text, selected
`editPaths`, and independently authored CLI `cases`. Each case supplies an
`id`, `args`, `stdin`, expected `stdout`, `stderr`, and `exitCode`. It accepts
16 files totaling 64 KiB, up to eight editable source paths, and eight cases.
There are no attachments. Its Agent slot selects an ordinary Flow through
project defaults or an explicit Binding route.

The operator binds `tests` to reviewed Bun test paths and `cli` to the project
entrypoint. The method first runs the original tests and CLI cases. A concrete
acceptance mismatch allows an Agent proposal of replacement text, never shell
commands. Binding `settings: { maxProposals: 1 }` stops after one proposal;
`maxProposals: 2` (the default) permits one correction after an invalid proposal
or failed candidate. Both configurations require identical checks for success.
Every proposal remains relative to the original.

Optional Binding `settings: { restoreCorrections: true }` uses the first
conversation for correction through native retention and restoration. The
operator must separately grant `retainSessions: true` to a qualified native
Agent (currently Codex). The first Agent call closes and settles before tests;
only a failed candidate or invalid proposal leads to one restored call with
the recorded feedback. No Agent stays active during command execution.

Unavailable retention does not invalidate a passing first patch. If correction
is needed, it returns `blocked` with the retention reason instead of silently
starting over. Restoration errors remain failures without retry. Final receipts
are recorded in `attempts[].session`. The method requests `lifetime: 'run'`:
references are single-use within this root Run, and confirmed root settlement
removes any remaining state. Recorded receipts are evidence, not cross-Run
continuation handles. Native transcripts include supplied source and feedback
and remain subject to the host's bounded retention policy. Without this setting, calls
stay ephemeral and compatible with ordinary one-shot Agent implementations.

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
