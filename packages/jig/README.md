# `@jigging/jig`

Put reusable Agent methods to work with powers you approve. Choose your Agents,
combine specialists, inspect their results, and stop owned work.

## Install

```console
npm install --global @jigging/jig@alpha
```

The developer alpha requires Linux x86_64/glibc, Bubblewrap, and a systemd user
manager with delegated cgroup v2 controllers. See the
[complete supported-host requirements](https://jig.md/guide/#supported-host).
npm installs Jig's exact Bun runtime dependency alongside the package.

## Get started

Create an editable first Flow:

```console
jig init hello-jig
cd hello-jig
jig review --allow-resolution-network
jig run flow:flows/hello --input '{"name":"Ada"}'
```

Initialization installs nothing and approves nothing. Review prepares the SDK
privately and asks for approval. The resolution flag allows dependency-selected
network requests before approval; declining cannot undo those requests. Runs
gain no network access. No separate Bun install is needed.

Read the [first Flow guide](https://jig.md/guide/#your-first-flow), or try
[an issue becoming a tested patch](https://jig.md/guide/tested-patch): selected
local source becomes a reviewable patch with executed checks, while the original
repository stays unchanged.

Jig has three project commands:

```text
jig init [--bare] <directory>
jig review [project] [--allow-resolution-network] [--yes] [--details]
jig run <flow:path|binding:id> [options]
```

`review` shows changed policy; `--details` includes complete current and proposed
policy. `--yes` approves without a prompt but does not grant resolution network
permission. `--bare` creates only an empty project skeleton.

`run` executes the approved revision and returns JSON after settling owned work
(NDJSON with `--receive`). Terminal-only elapsed status, cancellation updates,
and diagnostics use stderr, never protocol stdout. An application outcome such
as `blocked` is not task success even when execution completed correctly.
Use `jig <command> --help` for focused help and `jig --version` for the installed
version.

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
