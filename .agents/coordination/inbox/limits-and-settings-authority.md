# Centralize limits and settings authority

Postponed owner-requested work: give limits and settings a canonical source so
runtime defaults, configuration validation, CLI help and public documentation
cannot drift independently. This is future work, not a new merge requirement.

The Mac host's root Run timeout had diverged to 60 seconds while Linux and the
public contract specified 30. Both hosts now use the same 30-second value.

Native turn defaults and ranges share Jig's private `native-agent-turn-policy.ts`
across grant validation, controller dispatch and finite ACP enforcement. Boundary
checks verify agreement with the independently owned authoring schema. The
remaining inventory and ownership choices are still separate work.

- Inventory limits, defaults, allowed ranges, units, override precedence and
  genuine platform enforcement differences across code and configuration.
- Establish a canonical owner for each setting and derive or verify its
  configuration, help, documentation and regression expectations from that owner.
- Keep common policy shared across hosts; represent necessary platform differences
  explicitly without duplicating the whole policy.
- Preserve operator authority and FLOW's independence. Centralizing Jig settings
  must not move host policy into FLOW or silently alter an existing contract.
- Remove superseded duplicate definitions when implementing the selected design.

Triage the mechanism and scope separately; this entry does not select a new
configuration framework or authorize a broad refactor in the Mac-support PR.
