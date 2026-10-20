# contact-import-import

Call `reader` to capture the fixed `contacts.csv` file from the read-only `source` attachment.
Accept one UTF-8 file of at most 64 KiB, with 1–100 data records, 1–16 columns,
unique nonempty headings (80 characters), and cells of at most 2048 characters.
The reader uses a CSV parser for quoting and rejects malformed input before mapping.

Call `mapper` with headings only. On `done`, call `converter` with captured
rows and the proposed mapping. Call `exporter` with its complete `done` output
and a fresh `files` attachment. Check export metadata, then forward the immutable
files artifact as `artifactResults.preview`; the packet contains
`files/preview/preview.json`. The coordinator writes no files.
Preserve `blocked`, `limit`, errors, and cancellation
without retries. The preview is not a database import or a semantic guarantee.

The optional `progress` channel uses the standard reporting contract. **Mapping,
Contacts and Rejected rows** shows headings, checked column choices and bounded row
previews. Jig renders these same semantic declarations in terminal and web dashboards.
Views preserve literal outcomes and explicit excerpts; they do not execute actions or
establish host success.
