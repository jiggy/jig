# Codex managed-policy support and additional Mac qualification

The contained Codex profile supports notification-only preference refresh on
Intel macOS 14.4.1 build 23E224, while refusing configured managed policy.
Other macOS profiles and actual managed-policy consumption remain unqualified.
Installation discovery and review do not qualify session startup; limits are documented in the
[Agent guide](../../../docs/jig/guide/agents.md#codex).

Further support must preserve the execution boundary and operator policy
ownership. Forced policy or unavailable observation must stay visibly refused;
never skip policy or recommend removing operator settings to obtain startup.

Acceptance should include genuine native startup without network/model calls,
ordinary installed Agent consumption, managed-policy behavior, and existing
hostile-process/private-data protections. Unrestricted preference-service
access or skipping managed requirements is not established as a correction.
This item records postponed investigation, not an approved implementation.
