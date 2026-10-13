# Grouped photo copies

This independent method creates grouped, byte-identical copies and a CSV manifest.
It receives a read-only `source` attachment containing `photos.json` and its images,
and an initially empty writable `files` attachment.

The input contains only `assignments`, with one `{id, event}` entry for every photo.
The method reads every original and checks the complete catalogue and assignments
before writing. It derives safe names itself; callers cannot supply file paths or
assert that a plan has already been checked.

The complete result is `{outcome: "done", output: {count, photos, manifest: "manifest.csv"}}`.
Photo destinations and manifest copy paths are relative to this method's `files`
attachment. Copies use exclusive creation, and the originals remain untouched.
There is no Agent dependency. Progress is optional and remains provisional until
the host confirms the final result and file delivery.
