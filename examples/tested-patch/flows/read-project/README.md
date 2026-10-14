# Read a repair project

Receive an issue, permitted `editPaths` and optional check-set name. Capture
read-only UTF-8 source without executing it, then load fixed acceptance cases
from this Flow’s reviewed `NAME-cases.json`. Return the issue, files, editable
scope and cases as JSON for the repair specialist.

`capture.ts` owns source bounds and path checks. `checks.ts` owns the reviewed
case format. No writable attachment, Agent or command grant is needed. A source
error stops before any proposal work; the optional view reports capture counts.
