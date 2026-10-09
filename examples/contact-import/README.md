# Turn unfamiliar CSV files into contact previews

Your product expects `name`, `email`, and `organization`. Customers bring their
own column headings. This example recognizes a known export with code, asks an
Agent to interpret unfamiliar headings, and uses code to check and convert rows.
The importer calls the same mapping slot in all three configurations.

## Try it

With Jig installed on a [supported host](https://jig.md/guide/), run from this
directory. The default known-format preview uses code and needs no Agent:

```sh
jig review --allow-resolution-network
jig run
```

The CSV parser is an ordinary declared dependency. The resolution flag permits
fresh dependency resolution during this review; inspect and approve the result.
The reviewed entrypoint supplies the fixture, read attachment, one-minute deadline
and fresh `preview-known` output prefix. Jig reports the actual destination;
repeat `jig run` to receive another packet without replacing earlier results.

Open `files/preview.json` inside the reported destination. Ada and Mei have accepted contact
records. Grace's invalid email appears in `rejected`, with CSV record number 3.
`result.json` in that destination contains the execution result. These are synthetic
contacts, and no database records are created.

To use the Agent or mixed variants, configure a supported native client through
[Choose an Agent](https://jig.md/guide/agents). Their shared `grants/agent.json`
is selected by `bindings/model.ts`. Interactive review can offer a confirmed
client correction when the selected executable is missing; manual grant edits
also require review. Unavailable Agent routes do not block the code preview.
Mixed still requires its Agent route even when a particular input takes its code branch.

Now use different headings and a different column order:

```sh
jig run binding:code --input '{}' --attach source=fixtures/unfamiliar --out-new preview-unknown
jig run binding:agent --input '{}' --attach source=fixtures/unfamiliar --out-new preview-agent --timeout 2m
jig run binding:mixed --input '{}' --attach source=fixtures/unfamiliar --out-new preview-mixed --timeout 2m
```

Code returns `needs_mapping`. The Agent is asked to interpret `Organisation`,
`Courriel`, and `Nom complet`; the intended mapping is
`{"name":2,"email":1,"organization":0}`. Its answer may differ or it may abstain.
Mixed recognizes the known format in code and invokes the Agent only for
unfamiliar headings. Try `binding:mixed` with `fixtures/known` to take
the direct code path. `--out-new` selects a fresh destination each time; a fixed
`--out DIR` still requires a new directory.

## Follow the work

**Mapping** shows the headings and proposed column indices. **Contacts** shows accepted
preview records; **Rejected rows** explains exclusions. Lists show up to twelve records
with explicit totals and marked text excerpts; the complete returned output and
`preview.json` retain every record. Select the delivered preview reference to read its
content. The mapper and converter also offer domain views when invoked independently.
`needs_mapping` and rejected rows remain distinct from a completed import: no database
is changed.

Add `--display tui` for a terminal workspace or `--display web` for the same
views in a browser. Open the private link printed after execution starts. The completed inspector
stays open until you explicitly close it; leaving a live display does not cancel work.
Blocking causes remain reachable from every view. Plain output and `--json` remain
available.

## Follow the composition

| Package | Job |
| --- | --- |
| `flows/import` | Read `source/contacts.csv`, call `mapper`, call `converter`, write a final preview. |
| `flows/map-code` | Recognize the exact known headings, in any order. |
| `flows/map-agent` | Ask one Agent for column indices; send headings only, never rows. |
| `flows/map-mixed` | Recognize known headings in code; otherwise call the Agent Flow. |
| `flows/convert` | Check column indices, select and trim values, report accepted contacts and rejected rows. |

Compare `bindings/code.ts`, `agent.ts`, and `mixed.ts`. They select different
implementations of `mapper` while using the same importer and converter. The mixed
implementation combines code and an Agent Flow inside one leaf. Each method is self-contained;
none imports another Flow's implementation.
Review changes to code or Bindings before running them.

The mapping is a proposal of three zero-based column indices. It cannot contain
scripts or expressions. The converter requires distinct existing columns for
all three fields. Its small email rule checks basic shape, not deliverability.
CSV parsing uses `csv-parse`, including quoted commas and multiline fields.

## Watch an unsuitable proposal stop

This is deliberate fault injection into the converter, not a captured model answer:

```sh
jig run flow:flows/convert --input @fixtures/invalid-mapping.json
```

The supplied email column is 7, but the file has only three columns. The result
is `needs_mapping`, with no accepted contacts. `fixtures/ambiguous` contains two
email columns: the Agent is instructed to abstain, but prompting cannot guarantee
that it will. A structurally valid wrong mapping can still pass the code checks.
Inspect the mapping and preview before using them.

`fixtures/malformed` has duplicate headings and fails before calling a mapper:

```sh
jig run binding:code --input '{}' --attach source=fixtures/malformed --out-new preview-malformed
```

## Know what the result means

- `done` means a preview or mapping decision completed. `ready` can contain some
  or even all rejected rows. `needs_mapping` asks for clarification; it is not
  successful data import.
- `blocked` and `limit` remain visible without automatic fallback or retries.
  Execution errors and cancellation propagate. Ctrl-C cancels owned work.
- Input is one UTF-8 CSV named `contacts.csv`: at most 64 KiB, 100 data records,
  16 columns, 80 characters per heading, and 2048 per cell. Empty or duplicate
  headings are rejected. Record numbers include the header; quoted newlines
  do not create new record numbers. Blank lines are skipped.
- Only headings reach the configured Agent provider; headings themselves may
  contain sensitive text. The source stays unchanged. Only complete previews
  are delivered; the example does not save checkpoints.

## Make it your own

Change the destination fields, mapping instructions, and conversion rules for
one import task. Keep mapping and row validation separate. Database writes,
duplicate handling, and user confirmation belong to a consuming application;
this example stops at its reviewable preview.

Run `bun test examples/contact-import/test` from the repository root after
workspace setup. Tests use deterministic Agent substitutes and include a
structurally valid semantic mistake to make the limit of validation explicit.
The release gate also tests the application against the packed SDK.
