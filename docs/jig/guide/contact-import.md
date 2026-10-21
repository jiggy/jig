# Turn unfamiliar CSV files into contact previews

Your product expects `name`, `email`, and `organization`. Customers bring their
own column headings. This example recognizes a known export with code, asks an
Agent to interpret unfamiliar headings, and uses code to check and convert rows.
The importer calls the same mapping slot in all three configurations.

## Try it

With Jig installed on a [supported host](https://jig.md/guide/), run from this
directory. The default review selects only the code implementation: no Agent
installation or login is needed for the first preview.

```sh
jig review --allow-resolution-network
jig run
```

The CSV parser is an ordinary declared dependency. The resolution flag permits
fresh dependency resolution during this review. Inspect and approve the result.
The reviewed entrypoint supplies the fixture, read attachment and one-minute deadline.

This target declares a preview artifact, so Jig chooses a fresh packet in
operating-system temporary storage and reports its path on stderr.
Repeating `jig run` leaves earlier packets intact.
The operating system may clear temporary storage.
Use `jig run --out ./preview-result` to choose a new retained location.
Jig never overwrites an earlier result.

Open `files/preview/preview.json` inside the reported destination. Ada and Mei have accepted contact
records. Grace's invalid email appears in `rejected`, with CSV record number 3.
`result.json` in that destination contains the execution result. These are synthetic
contacts, and no database records are created.

To try Agent interpretation, first configure and authenticate the client in
`bindings/model.ts` through [Choose an Agent](https://jig.md/guide/agents).
Then replace `jig.ts` with this ordinary project selection:

```ts
import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint: "binding:code --input '{}' --attach source=fixtures/known --timeout 1m",
  flows: discover('flows'),
  bindings: discover('bindings'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:model',
  },
})
```

Review this change before invoking `binding:agent` or `binding:mixed`:

```sh
jig review --allow-resolution-network
```

The initial selection leaves Agent routes outside review. After enabling them,
review checks the selected client even if you plan to run the code Binding. An
unavailable selected client stops new approval. Mixed still requires its Agent
route when a particular input takes its code branch.

Use `jig review --agent CLIENT --allow-resolution-network` to propose another
installed client (`codex`, `claude` or `pi`) for that review. Source stays
unchanged. Repeat the flag on later reviews or edit the Binding for a lasting
choice.

Now use different headings and a different column order:

```sh
jig run binding:code --input '{}' --attach source=fixtures/unfamiliar
jig run binding:agent --input '{}' --attach source=fixtures/unfamiliar --timeout 2m
jig run binding:mixed --input '{}' --attach source=fixtures/unfamiliar --timeout 2m
```

Code returns `needs_mapping`. The Agent is asked to interpret `Organisation`,
`Courriel`, and `Nom complet`; the intended mapping is
`{"name":2,"email":1,"organization":0}`. Its answer may differ or it may abstain.
Mixed recognizes the known format in code and invokes the Agent only for
unfamiliar headings. Try `binding:mixed` with `fixtures/known` to take
the direct code path. Each invocation receives its own temporary packet unless
you choose a new destination with `--out DIR`.

## Follow the work

**Contact preview** is one application page: source record count, accepted and
excluded totals, source heading → contact field mapping, accepted contacts,
and reasons for correction. Reading, mapping, checking and export update that
page as the work advances. Lists show up to twelve records with explicit
totals and marked excerpts. The complete output and `files/preview/preview.json`
preserve every value.

The complete preview reference opens the delivered file. Child Flow views
remain available through Inspector and when invoked independently.
`needs_mapping` asks for clarification. A completed preview never means
contacts were imported into a database.

Add `--display tui` for a terminal workspace or `--display web` for the same
views in a browser. Open the private link printed after execution starts. The completed inspector
stays open until you explicitly close it; leaving a live display does not cancel work.
Blocking causes remain reachable from every view. Plain output and `--json` remain
available.

## Follow the composition

| Package | Job |
| --- | --- |
| `flows/import` | Coordinate reading, mapping, conversion and export. Own the application page. |
| `flows/read-contacts` | Capture and parse one bounded `source/contacts.csv` without modifying it. |
| `flows/map-code` | Recognize the exact known headings, in any order. |
| `flows/map-agent` | Ask one Agent for column indices; send headings only, never rows. |
| `flows/map-mixed` | Recognize known headings in code; otherwise call the Agent Flow. |
| `flows/convert` | Check column indices, trim values and explain accepted or rejected rows. |
| `flows/export-preview` | Write the supplied preview into its own output attachment. |

Compare `bindings/code.ts`, `agent.ts`, and `mixed.ts`. They select different
implementations of `mapper` while using the same reader, converter and
exporter. The mixed implementation combines code and an Agent Flow inside one
leaf. Each method is self-contained.

None imports another Flow's implementation. The reader gets read-only source
access. The exporter gets only fresh writable output authorized by `bindings/code.ts`.
The coordinator requests that output and forwards the returned immutable artifact as `preview`.

The coordinator writes no files and checks export metadata before offering the
complete preview reference. Review changes to code or Bindings before running
them.

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
jig run binding:code --input '{}' --attach source=fixtures/malformed
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
