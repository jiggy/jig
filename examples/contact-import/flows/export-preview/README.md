# Export a contact preview

Receive a complete contact preview and write `files/preview.json` with exclusive
creation. Return its status, accepted/rejected counts and filename. This Flow
has one writable attachment and no Agent or source access.

The caller owns mapping and row checks. Export is formatting and file delivery,
never contact import or evidence of semantic correctness. The coordinator maps
this output to `preview/contacts` and checks its metadata before offering a file
reference. Failed or interrupted writes do not establish a complete preview.
