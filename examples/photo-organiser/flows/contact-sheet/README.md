# Before-and-after contact sheet

This independent method renders `contact-sheet.svg` from original image bytes.
It receives a read-only `source` attachment containing `photos.json` and its images,
and an initially empty writable `files` attachment. It never reads grouped copies
or another method's output.

The input contains only `assignments`, with one `{id, event}` entry for every photo.
The method validates the entire catalogue, every image and all assignments before
rendering. It derives copy labels itself and escapes text in the generated SVG.

The complete result is `{outcome: "done", output: {count, contactSheet: "contact-sheet.svg"}}`.
The sheet embeds its images so it can be opened independently. It uses exclusive
creation and leaves originals untouched. There is no Agent dependency. Progress
is optional and remains provisional until the host confirms the final result
and file delivery.
