# `@jigging/jig`

Put reusable Agent methods to work with powers you approve. Choose your Agents,
combine specialists, inspect their results, and stop owned work.

## Install

```sh
npm install --global @jigging/jig@alpha
```

The developer alpha requires Linux x86_64/glibc, Bubblewrap, and a systemd user
manager with delegated cgroup v2 controllers. See the
[complete supported-host requirements](https://jig.md/guide/#supported-host).
npm installs Jig's exact Bun runtime dependency alongside the package.

## Get started

Create an editable first Flow:

```sh
jig init hello-jig
cd hello-jig
jig review --allow-resolution-network
jig run flow:flows/hello --input '"Ada"'
```

Initialization installs nothing and approves nothing. Review prepares the SDK
privately and asks for approval. The resolution flag allows dependency-selected
network requests before approval; declining cannot undo those requests. Runs
gain no network access. No separate Bun install is needed.

Then [add a support-reply Agent](https://jig.md/guide/agents#build-your-first-agent-method)
to that same project. Read the [first Flow guide](https://jig.md/guide/#your-first-flow), or try
[an issue becoming a tested patch](https://jig.md/guide/tested-patch): selected
local source becomes a reviewable patch with executed checks, while the original
repository stays unchanged.

Project commands:

```text
jig init [--bare] <directory>
jig review [project] [--generate-contracts] [--allow-resolution-network] [--allow-authority-changes] [--yes] [--details]
jig run <flow:path|binding:id> [options]
jig inspect [flow:path|binding:id] [--json]
```

`review` shows changed policy; `--details` includes complete current and proposed
policy. `--yes` approves without a prompt but does not grant resolution network
permission. `--bare` creates only an empty project skeleton.

A Binding can pin a declared read attachment with
`attachments: { reference: './resources/reference' }`. Review captures and
identifies its files; Runs use those approved bytes without repeating `--attach`
or exposing the live source directory. See [working with files](https://jig.md/guide/files).

For service access, `slots: { reference: { grant: 'documents' } }` selects an independently
configured operator grant. Jig enforces its exact endpoint, method, credential
reference and limits outside the Flow. The same ordinary call can retrieve a
document or support an editable API client without handing it a secret or a
network socket. See [delegated HTTP access](https://jig.md/guide/http).

`--generate-contracts` compiles authored TypeSpec contracts and publishes their
managed JSON and types before the separate execution-approval question. Plain
review does not compile; already-generated contracts need no compiler runtime.

`inspect` lists approved targets or shows a target's retained interface without
evaluating source, contacting providers, preparing dependencies or changing state.
It checks that approval against current local execution identities and reports
changed or unverifiable environments. It does not check visible source edits,
launch readiness or remote availability; Run still revalidates before execution.

`run` executes the approved revision and shows a YAML terminal result after
settling owned work. `--receive` streams labelled channel text. Redirect stdout
or use `--json` for exact JSON (NDJSON with `--receive`). Terminal-only elapsed
status, cancellation updates, and diagnostics use stderr. An application outcome such
as `blocked` is not task success even when execution completed correctly.
Use `jig <command> --help` for focused help and `jig --version` for the installed
version.

Agents are ordinary Flow packages. Select an admitted implementation with
`defaults: ['binding:agent']` in `jig.ts`, or through an explicit consumer slot.
Its Binding grants the underlying HTTP endpoint or finite ACP resource;
replacing the method does not require a host plugin.

Native Codex, Claude Code, and Pi clients selected by ACP grants are discovered on the operator's
`PATH`. Absolute `CODEX_PATH`, `CLAUDE_PATH`, and `PI_PATH` overrides select a
specific installation. Review shows the resolved executable; project-local
binaries are excluded from implicit discovery. See [Choose an Agent](https://jig.md/guide/agents)
for supported installations and authentication.

## Guides

- [Markdown methods](https://jig.md/guide/markdown)
- [Choose an Agent](https://jig.md/guide/agents)
- [Working with files](https://jig.md/guide/files)
- [Delegated HTTP access](https://jig.md/guide/http)
- [Dependencies](https://jig.md/guide/dependencies)
- [Author contracts once](https://jig.md/guide/contracts)
- [Workflow design](https://jig.md/guide/workflow-design)
- [Project authoring](https://jig.md/spec/project-sdk)
- [Execution policy](https://jig.md/spec/project-policy)
- [Security boundary](https://github.com/jiggy/jig/blob/main/SECURITY.md)

Jig is prerelease software. [FLOW](https://flow.jig.md/) remains an independent
standard for portable methods.

Copyright © 2026 Victor Duarte <zvictor> and contributors.
