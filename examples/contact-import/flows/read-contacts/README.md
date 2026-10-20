# Read contact CSV

Read `source/contacts.csv` without changing it. This Flow owns UTF-8 decoding,
CSV parsing, header checks and size limits. It returns `{headers, rows}` with
no Agent call or writable attachment. Quoted commas and multiline cells are
parsed by the declared `csv-parse` dependency.

```sh
jig run flow:flows/read-contacts --input '{}' --attach source=fixtures/known
```

Input is an empty object; source must contain one bounded contact CSV. See
`FLOW.contract.json` and `csv.ts` for limits. The optional view reports captured
column and record counts. Mapping and contact acceptance belong to other Flows.
