---
name: contact-import-map-mixed
description: Try the known format first, then ask the interpreter when it is unknown.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
outcomes:
  blocked: The selected method cannot complete its work.
  limit: The Agent reaches its limit.
---

Recognize exactly `Customer`, `Email address`, and `Company`, in any order, and
return their indices without an Agent call. Otherwise use one Agent capability
call to propose three distinct indices or a null mapping. Send headings only.

This leaf combines ordinary code with Agent work internally. Current Jig child
Bindings cannot declare further child slots; this method does not claim recursive
Flow composition. Keep its public mapping contract identical to the code and
Agent variants. Preserve blocked and limited outcomes and propagate errors
without retry. Structural validity does not establish correct interpretation.
