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

Use `jig inspect` to list targets in the last approved revision. Use
`jig inspect binding:repair` (or an exact `flow:` target) to read its input,
settings and result schemas, configured settings, child slots, capabilities,
attachments, channels and commands. `--json` or redirected stdout returns JSON.
Inspection compares approval with current local execution identities, including
selected children. It reports `environment-matches`, `review-required`, or
`unchecked` when verification is unavailable. Missing Agent configuration can
leave Agent-using targets unchecked without hiding their retained interfaces.
It performs no provider requests, source evaluation, dependency preparation,
state recovery or approval. Matching identities do not promise source freshness,
launch readiness or remote availability; Run still revalidates before execution.
Use `jig review` to review edits or a changed environment. Snapshot reads return
exit 0 even when review is required; scripts should examine `state`.
Without local approval, it reports `unreviewed`, even if a portable lock exists.

Type errors identify the value's location and, where available, its expected
and received JSON types. They do not print the rejected value. For example,
`Expected string; received object.` means the caller should pass a JSON string,
not wrap it in an object. `jig inspect <target>` shows the approved input contract.

Interactive stdout leads with execution and application outcome, plus packet
delivery and unconfirmed cleanup when present, then retains the complete result.
Application fields such as `success` are data, not host verdicts. With `--receive`, channel text
streams continuously under labelled headings. Use `--json` for raw records in
a terminal. Redirected stdout automatically contains exact JSON, or NDJSON
when `--receive` is selected. Stderr
carries diagnostics and, on a terminal, elapsed status and cancellation updates.
Piped stdout remains machine-readable. Interactive terminals show one active
status line and use color for headings and outcomes. Set `NO_COLOR=1` or
`TERM=dumb` for plain output without animation; redirected streams are always
plain. Errors put the explanation and next action before the diagnostic code.
The [CLI experience contract](../spec/cli-experience.md) defines these guarantees. Ctrl-C requests cancellation; wait for cleanup before starting new
work. An interruption or uncertain result is not permission to blindly retry.
An interrupted command may exit without a JSON result; scripts must check the
exit status and handle an absent terminal value.

A `REVIEW_REQUIRED` diagnostic means the current execution environment differs
from the approved revision. No Flow started for that Run. Run `jig review`, inspect
and approve the proposed revision, then explicitly start a new Run. A Jig rebuild,
runtime change, Agent configuration change, or changed sandbox support can require
review even when your project source is unchanged. In machine output this is
host-only `code: "REVIEW_REQUIRED"` with
`details.reason: "EXECUTION_ENVIRONMENT_CHANGED"` and `details.flowStarted: false`.
Review distinguishes environment-only changes from source, prepared dependency,
and permission changes. The retained combined fingerprint does not identify which
individual historical component changed; review states this evidence limit.

An `EXECUTION_FAILED` result with no captured diagnostic text does not establish
whether the Flow started. The public result contains no more specific cause;
keep the command and diagnostic code for investigation and inspect any effects
before starting new work.

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
