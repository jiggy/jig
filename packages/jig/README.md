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
jig new <name>
jig review [project] [--allow-resolution-network] [--yes] [--details]
jig run [flow:path|binding:id] [options]
jig inspect [flow:path|binding:id] [--json]
jig completion <bash|zsh|fish>
```

`review` shows changed policy; `--details` includes complete current and proposed
policy. `--yes` approves without a prompt but does not grant resolution network
permission. `--bare` creates only an empty project skeleton.

`new` adds ordinary editable source under `flows/<name>` without installation or
approval. Interactive `jig run` can offer an explicit choice of approved targets;
scripts must name a target. Shell completion also reads only approved targets.

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

For projects that use an Agent, interactive `jig review` asks you to choose a
locally available client and remembers the choice for this project. Credentials
alone do not select a provider. Scripts can set `JIG_AGENT_CLIENT` to `codex`,
`claude`, `pi`, or `api`; `--yes` approves changes without choosing a client.
The menu distinguishes native live updates from API final results.

Native Codex, Claude Code, and Pi clients are discovered on the operator's
`PATH`. Absolute `CODEX_PATH`, `CLAUDE_PATH`, and `PI_PATH` overrides select a
specific installation. Review shows the resolved executable; project-local
binaries are excluded from implicit discovery. See [Choose an Agent](https://jig.md/guide/agents)
for supported installations and authentication.

## Guides

- [Choose an Agent](https://jig.md/guide/agents)
- [Working with files](https://jig.md/guide/files)
- [Dependencies](https://jig.md/guide/dependencies)
- [Workflow design](https://jig.md/guide/workflow-design)
- [Project authoring](https://jig.md/spec/project-sdk)
- [Execution policy](https://jig.md/spec/project-policy)
- [Security boundary](https://github.com/jiggy/jig/blob/main/SECURITY.md)

Jig is prerelease software. [FLOW](https://flow.jig.md/) remains an independent
standard for portable methods.

Copyright © 2026 Victor Duarte <zvictor> and contributors.
