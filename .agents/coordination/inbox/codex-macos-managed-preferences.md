# Codex managed-preference startup on macOS

Codex 0.159.0 fails the existing network-disabled, dummy-credential native
startup check at `session/new`: configuration loading reports that managed
preferences could not be synchronized. The current native containment does
not support that preference refresh. Installation discovery and review do
not qualify session startup; the limitation is documented in the
[Agent guide](../../../docs/jig/guide/agents.md#codex).

Investigate a correction that preserves the execution boundary and operator
policy ownership. A transparent closed diagnostic identifies this report;
it does not repair startup or establish why preference synchronization failed.

Acceptance should include genuine native startup without network/model calls,
ordinary installed Agent consumption, managed-policy behavior, and existing
hostile-process/private-data protections. Unrestricted preference-service
access or skipping managed requirements is not established as a correction.
This item records postponed investigation, not an approved implementation.
