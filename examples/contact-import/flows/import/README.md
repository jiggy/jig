# contact-import-import

Read the fixed `contacts.csv` file from the read-only `source` attachment.
Accept one UTF-8 file of at most 64 KiB, with 1–100 data records, 1–16 columns,
unique nonempty headings (80 characters), and cells of at most 2048 characters.
Use a CSV parser for quoting; reject malformed input before calling children.

Call `mapper` with headings only. On `done`, call `converter` with captured
rows and the proposed mapping. Write its complete `done` output to
`preview/preview.json`. Preserve `blocked`, `limit`, errors, and cancellation
without retries. The preview is not a database import or a semantic guarantee.

The optional `progress` channel uses the standard user-updates contract. **Mapping,
Contacts and Rejected rows** shows headings, checked column choices and bounded row
previews. Jig renders these same semantic declarations in terminal and web dashboards.
Views preserve literal outcomes and explicit excerpts; they do not execute actions or
establish host success.
