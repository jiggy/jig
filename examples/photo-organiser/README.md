# Put a messy photo box in order

Twelve pictures have inconsistent filenames. An Agent groups their captions into
events; code checks every assignment and creates neatly named copies. The originals
stay untouched. Open the before-and-after contact sheet to see the result immediately.

The supplied pictures are small, labelled synthetic SVG illustrations of a lake
picnic, a birthday party and a mountain walk. Each scene has a distinct detail
matching its caption: sandwiches, balloons, presents, hikers or a summit flag. The Agent reads captions and dates
from `photos.json`, not image pixels. This demonstrates useful grouping without
requiring a vision model or EXIF tooling.

## Try it

Install Jig on a [supported host](https://jig.md/guide/) and configure a supported
[ACP client](https://jig.md/guide/agents) in `grants/agent.json`. The shipped grant
selects Codex; edit it to your installed client and model. From this directory:

```sh
jig review --allow-resolution-network
jig run
```

Review captures the project and resolves its declared dependencies; inspect and
approve the selected Agent and powers. The default entrypoint supplies the source
fixture and a two-minute deadline. Jig creates a fresh temporary result packet and
prints its location. Inside its `files` directory you will find:

- `contact-sheet.svg`: all twelve originals beside the grouped, renamed copies.
- `manifest.csv`: each original filename, event, date and destination.
- One folder per event, containing byte-for-byte copies of the source images.

Open `contact-sheet.svg` in your browser or image viewer. Event labels are Agent
choices; they may differ between runs. Code checks completeness and safe filenames,
not whether the chosen events correctly interpret every caption.

Temporary packets may be cleared by the operating system. To retain the result:

```sh
jig run --out ./organised-photos
```

That destination must be new. Jig never overwrites an earlier result.

## Follow the work

Add `--display tui` or `--display web` to see **Photo box**, a complete list of
original filenames and checked destinations with artifact references.
Open `contact-sheet.svg` from the result packet in a browser or image viewer to
see before and after. Shared image previews are awaiting runtime qualification.
`manifest.csv` offers a coloured table or raw text in the browser, and coloured
columns in the TUI.

Each Flow uses `withReporting` from `@jigging/reporting` for its optional
`progress` channel. Its `contracts/reporting` folder carries the complete
`jig:reporting` descriptor and license, so reviewing the Flow needs no online
contract lookup.

## Make it your own

Change a caption in `fixtures/photos/photos.json`, review again and run. The Agent
should reconsider its event grouping. To use your own images, put up to twelve
PNG/JPEG files in one source folder with a `photos.json` array:

```json
[
  {
    "id": "p01",
    "file": "IMG_0198.jpg",
    "date": "2026-06-14",
    "caption": "Friends unpack lunch beside the lake"
  }
]
```

Use simple filenames with letters, digits, hyphens or underscores. Each image
must fit in 256 KiB; the catalogue fits in 8 KiB. Captions contain at most 240
characters. Dates must be real calendar dates. IDs and filenames are unique,
including when case is ignored. The fixture SVG format is intentionally restricted
to inert illustrations without scripts, links or embedded resources. PNG/JPEG
signatures are checked; this is not a general image decoder or integrity checker.

Run with your folder as the read-only source:

```sh
jig run binding:organise --input '{}' --attach source=/path/to/photos --timeout 2m
```

Captions and dates reach your configured Agent provider; photo bytes do not.
Keep those captions appropriate for that provider.

## What keeps the operation bounded

Two Flows compose through `run.call()`:

```text
organise → group → configured Agent
```

`flows/organise` captures the source, asks the grouping Flow for a proposal,
checks every assignment and writes the accepted copies. `flows/group` receives
only IDs, dates and captions, calls the ordinary Agent method once, and returns
provisional assignments. Its contract declares no file attachments. The
`bindings/organise.ts` and `bindings/group.ts` files make this composition
explicit, so you can replace grouping without changing file handling.

Inside the organiser, `method.ts` is the short procedure. `catalogue.ts` captures
and checks source files, `plan.ts` checks assignments and derives safe paths,
`delivery.ts` writes copies and the CSV, `contact-sheet.ts` renders the SVG,
and `view.ts` projects
the results for inspection. These modules describe the current implementation.
`flows/copy-photos` and `flows/contact-sheet` also expose those capabilities as
independently callable Flows, each with its own validation, contract and optional
view. The organiser keeps its local file modules until mapped child attachments
are qualified; its current Binding composition calls grouping only. The separate
file methods do not enable that host gate or establish admitted execution.
Small mechanical helpers remain ordinary modules inside their owning Flow.

`flows/group/proposal.schema.json` is passed to the Agent as `responseSchema`.
It requests an answer shaped like this:

```json
{ "assignments": [{ "id": "p01", "event": "Lake Picnic" }] }
```

The schema requires 1–12 assignments, string IDs and event labels, and no extra
fields. It does not establish that every source photo appears exactly once or
that the event labels can safely become folder names. `plan.ts` checks those
rules against the captured catalogue. `FLOW.contract.json` has a separate role:
it defines the inputs, outcomes and result shape of the grouping Flow itself.

The grouping Flow can also be called independently with a `photos` array of
`{ id, date, caption }` records. It proposes groups; the organiser owns acceptance
and file effects. The Agent receives no filesystem
attachment and cannot choose output paths. Code derives names from dates,
normalized event labels and stable IDs.

Every known photo must appear exactly once. Unknown, duplicate or missing IDs,
unsafe labels and conflicting normalized group names fail before output writes.
All source images are captured before the Agent call. Writes use exclusive creation;
execution failures, cancellation and partial output never become a completed result.
The full proposal must validate before any copies are written. No retry or silent
fallback follows `blocked`, `limit`, uncertain dispatch or cancellation.

The tests construct duplicate, missing and unknown ID proposals, and prove that
invalid proposals create no files. Deterministic substitutes establish those
checks, not live model quality or injection resistance.

From the repository root after workspace setup:

```sh
bun test examples/photo-organiser/test
```

The tests validate the emitted request with the same public Agent preparation
used by ACP, then cover copied bytes, complete contact-sheet contents, invalid proposals,
source validation, cancellation and ordinary reporting declarations. Installed
host execution and live Agent quality require separate evidence.
