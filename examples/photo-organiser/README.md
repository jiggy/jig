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

- `overview/contact-sheet.svg`: all twelve originals beside the grouped, renamed copies.
- `copies/manifest.csv`: each original filename, event, date and destination.
- One folder per event inside `copies`, containing byte-for-byte copies of the source images.

Open `overview/contact-sheet.svg` in your browser or image viewer. Event labels are Agent
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
Open `overview/contact-sheet.svg` from the result packet in a browser or image viewer to
see before and after. Shared image previews are awaiting runtime qualification.
`copies/manifest.csv` offers a coloured table or raw text in the browser, and coloured
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

Four focused application Flows compose through `run.call()`:

```text
organise
  ├─ group → configured Agent
  ├─ copy-photos → copies/
  └─ contact-sheet → overview/
```

`flows/organise` reads and checks every source image before asking the grouping
Flow for a proposal. It accepts every assignment before calling either file Flow,
then checks their complete results before reporting a finished collection.
`flows/group` receives only IDs, dates and captions, calls the ordinary Agent method once, and returns
provisional assignments. Its contract declares no file attachments. The
`bindings/organise.ts` maps the immutable `source` view to each file Flow and
authorizes a fresh `files` output for each operation. After each call completes
and cleanup settles, Jig supplies a sealed artifact. The organiser forwards the
two artifacts as final results named `copies` and `overview`, without copying
them into a writable organiser folder. `bindings/group.ts` selects the configured
Agent. These declarations make each responsibility explicit.

Inside the organiser, `method.ts` coordinates calls. `catalogue.ts` checks the
source, `plan.ts` accepts assignments and checks child result metadata, and
`view.ts` projects the completed collection for inspection. The organiser writes
no photo files itself.

`flows/copy-photos` owns byte-preserving copies and the CSV. `flows/contact-sheet`
renders the SVG independently from the original images. Both receive only checked
`{assignments: [{id, event}]}` data, revalidate all originals and assignments, and
remain independently callable root Flows with their own contracts and optional
views. Their returned paths stay relative to their own `files` attachments;
the organiser's final artifact names supply `copies/` and `overview/` packet
prefixes. Artifact references name the selected tree and its output-relative path.
The manifest describes paths relative to its `copies` folder.
Small mechanical helpers remain ordinary modules inside their owning Flow;
no Flow imports another Flow's private implementation.

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
unsafe labels and conflicting normalized group names fail before either file call.
All source images are checked before the Agent call. Each file Flow rechecks them
and writes with exclusive creation. A failed file call or inconsistent result
prevents the organiser from reporting a complete collection; a failed root exports
no partial photo files. The full proposal must validate before any copies are
written. No retry or silent fallback follows `blocked`, `limit`, uncertain dispatch
or cancellation.

The tests construct duplicate, missing and unknown ID proposals, and prove that
invalid proposals create no files. Deterministic substitutes establish those
checks, not live model quality or injection resistance.

From the repository root after workspace setup:

```sh
bun test examples/photo-organiser/test
```

The tests validate the emitted request with the same public Agent preparation
used by ACP, then cover composed leaf calls, copied bytes, contact-sheet contents,
invalid proposals, inconsistent child results, source validation, cancellation
and ordinary reporting declarations. The test call seam models folder visibility
with temporary folders; it does not prove native imports. Installed
host execution and live Agent quality require separate evidence.
