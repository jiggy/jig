# Photo studio

Six photographs become checked event galleries and a printable family yearbook.
An Agent groups captions and dates, while code validates assignments and preserves original bytes.
The supplied photographs are generated fictional scenes, with provenance in `fixtures/photos/manifest.json`.
The Agent receives captions, dates and IDs, never image pixels or file access.

## Try it

Install Jig on a [supported host](https://jig.md/guide/) and configure an [ACP client](https://jig.md/guide/agents) in `grants/agent.json`.
The shipped grant selects Codex.
From this directory:

```sh
jig review --allow-resolution-network
jig run --display web
```

Review captures the project and resolves declared dependencies.
Inspect the selected Agent and powers before approving.
The default entrypoint supplies the fixture, album title and a two-minute deadline.

## Follow the work

Photos presents the captured originals and captions.
Organise shows checked event galleries, progress and stopped causes.
Yearbook presents a cover, chapter outline, large photographs and a captured PDF download.
The six-photo fixture produces twelve pages when grouped into three events.
Other valid groupings produce a different chapter count and page count.

The completed packet contains:

- `book/yearbook.pdf`: a printable A4 yearbook with cover, contents, chapters and closing page.
- `overview/contact-sheet.svg`: the originals beside grouped, renamed copies.
- `copies/manifest.csv`: original filenames, events, dates and destinations.
- Event folders inside `copies`, containing byte-for-byte source copies.

The PDF download appears only after every output passes application checks.
Stopped work retains known photographs and checked plans without claiming completed outputs.
Child views preserve their own publishers and evidence ownership.
The shared web renderer owns presentation, with no example-specific viewer.

Temporary packets may be cleared by the operating system.
To retain the result at a new destination:

```sh
jig run --display web --out ./organised-photos
```

## Make it your own

Change a caption in `fixtures/photos/photos.json`, review again and run.
To supply your own images, place up to twelve PNG/JPEG files beside a `photos.json` array:

```json
[
  {
    "id": "p01",
    "file": "IMG_0198.jpg",
    "date": "2025-06-14",
    "caption": "Friends unpack lunch beside the lake"
  }
]
```

Use simple filenames with letters, digits, hyphens or underscores.
Each image must fit in 256 KiB, and the catalogue must fit in 8 KiB.
Captions contain at most 240 characters, dates must exist, and IDs and filenames must remain unique when case is ignored.
PNG/JPEG signatures are checked before grouping, and the yearbook renderer must decode supported image bytes before writing its PDF.
Captions and dates reach your configured Agent provider.

```sh
jig run binding:organise --input '{"albumTitle":"Our photographs"}' --attach source=/path/to/photos --timeout 2m
```

## Application boundaries

Five independently callable Flows compose through `run.call()`:

| Flow | Responsibility |
| --- | --- |
| `organise` | Capture sources, accept assignments and child results, publish application views |
| `group` | Request one caption-only Agent proposal |
| `copy-photos` | Revalidate inputs, preserve image bytes and write the CSV manifest |
| `contact-sheet` | Revalidate inputs and render the before-and-after SVG |
| `yearbook` | Revalidate inputs and render the printable PDF |

The coordinator validates every source before paid work and the complete proposal before file calls.
Each file Flow receives read-only `source` and a fresh writable `files` attachment.
Each independently checks the catalogue and assignments, then creates outputs exclusively.
The coordinator forwards sealed artifacts as `copies`, `overview` and `book` without writing files itself.
References use those attachment names and leaf-relative paths.

Unknown, duplicate or missing IDs and conflicting normalized event names fail before output effects.
A failed call or inconsistent result prevents a completed collection claim.
Cancellation and uncertain dispatch never trigger silent retries.
Filename checks establish completeness and safe paths, while event interpretation still needs human review.

Each Flow uses the public reporting package and carries its exact offline descriptor and license.
Photos, Organise and Yearbook share a catalogue-derived subject key, while publisher attribution remains separate.
All five packages retain their own contracts and independently callable entrypoints.

## Verification

From the repository root after workspace setup:

```sh
bun test examples/photo-organiser/test
```

Tests cover response-schema preparation, acceptance boundaries, source validation and portable reporting projections.
File tests check preserved bytes, contact-sheet contents, PDF page counts, invalid inputs, cancellation and exclusive creation.
The installed consumer separately exercises frozen packages and native ownership cleanup with a real caption-task Flow.
These checks do not establish live Agent grouping quality or browser design parity.
