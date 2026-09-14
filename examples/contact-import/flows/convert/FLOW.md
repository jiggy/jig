---
name: contact-import-convert
description: Validate a mapping and turn supplied rows into contacts and row errors.
outcomes:
  blocked: The selected method cannot complete its work.
  limit: The Agent reaches its limit.
---

Use supplied rows and the proposed mapping; no Agent or child is called.
Require three distinct integer indices referencing existing headings. Null or
invalid mapping returns `done` with `status: needs_mapping` and no contacts.

For a valid mapping, select and trim cells. Reject rows of the wrong width,
empty names or organizations, and email values that fail the basic format rule.
Return accepted contacts and rejected record numbers, counting the header as 1.
`ready` means preview construction completed, even if all rows were rejected.
Expose the mapping for review: valid structure cannot establish correct meaning.
No database records are written.
