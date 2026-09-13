---
title: Results and recovery
---

# Results and recovery

Jig reports execution status separately from the method's application outcome.
Use both to decide what happened and whether another action is appropriate.
For your first successful invocation, start with [the quickstart](./index.md).

## Read results and diagnose failures

`jig <command> --help` explains that command's options and examples. Invalid
syntax is diagnosed even when the host cannot execute Runs. Errors identify a
relevant project-relative location where available and suggest a safe next step.
A missing target lists targets from the approved revision; Jig never picks one
for you.

Stdout contains the JSON result, or NDJSON when `--receive` is selected. Stderr
carries diagnostics and, on a terminal, elapsed status and cancellation updates.
Piped stdout remains machine-readable. Interactive terminals show one active
status line and use color for headings and outcomes. Set `NO_COLOR=1` or
`TERM=dumb` for plain output without animation; redirected streams are always
plain. Errors put the explanation and next action before the diagnostic code.
The [CLI experience contract](../spec/cli-experience.md) defines these guarantees. Ctrl-C requests cancellation; wait for cleanup before starting new
work. An interruption or uncertain result is not permission to blindly retry.
An interrupted command may exit without a JSON result; scripts must check the
exit status and handle an absent terminal value.

A protocol error means the Flow did not complete Run/1 correctly. Check its
SDK revision and stdout use, then inspect the result and any effects before
running again. After changing source or dependencies, review the changes first.

Execution completion is different from task success: a method can execute
correctly and return an application outcome such as `blocked`. Inspect the
outcome, output, and exit status. With `--out`, also inspect the separate
delivery status. Existing output directories are never replaced; choose a new
destination for another Run.

## If retained state cannot be opened

`PROJECT_STATE_INVALID` means `.jig` is incompatible with the current build or
damaged. Reinstalling dependencies does not change that state. Preserve `.jig`
and `jig.lock` for recovery; once prior work is confirmed stopped and cleaned up,
move them outside the project and run `jig review` for fresh approval. Keep the
source and dependency locks. If cleanup is uncertain, recover the owned work
before replacing its state.

### Reading review changes

Review shows a field diff: `-` is the previous or removed value, and `+` is
its proposed replacement or addition. Nested headings keep each changed field
in context. Unchanged fields are omitted; `jig review --details` retains the
complete previous and proposed public policy.

A target can need renewed approval when its retained execution identity or a
selected child changes even though its public fields are identical. Review
explains this instead of repeating identical blocks. Private execution
identities remain private. Object key ordering alone is ignored; array order
is significant.

### Syntax colors

Structured review output highlights keys, strings, numbers, and literals.
Choose accents to match your terminal background:

```sh
JIG_THEME=one-dark jig review
JIG_THEME=one-light jig review
JIG_THEME=macchiato jig review
```

One Dark is the default. Use `export JIG_THEME=one-light` in your shell profile
for a persistent preference. This is a shell setting, not a `jig.ts` field, so
it also applies before a project loads. Truecolor terminals receive the full
palette; other color terminals use 256-color approximations or basic accents.
`NO_COLOR`, `TERM=dumb`, and redirected output remain plain. Run JSON/NDJSON
is never highlighted.

Palettes use [Atom One Dark](https://github.com/atom/one-dark-syntax),
[Atom One Light](https://github.com/atom/one-light-syntax), and
[Catppuccin Macchiato](https://catppuccin.com/palette/) foreground accents.
