# Repository instructions

## No prerelease compatibility

Jig and FLOW are prerelease projects. Do not retain deprecated, superseded,
transitional, or compatibility-only code, schemas, formats, migrations, tests,
aliases, or documentation. When one design replaces another, remove the old
path completely in the same change.

Preserve compatibility only when the user explicitly requires it for an
already released external interface.
