# Export repair review files

Receive an issue, captured originals and supplied checked review data. Format
complete-file patches, retain each proposal, and write a goal and summary into
one writable output attachment. Include `review.patch` only when the supplied
review data reports acceptance. Return the exact produced filenames.

The caller owns evidence acceptance: independently calling this exporter can
format caller claims, but cannot prove that checks ran. The application first
calls `check-repair` and imports this folder at `deliverables/review`. Exclusive
creation preserves existing files. This Flow never applies a patch or runs code.
