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

[Create your first Flow](https://jig.md/guide/#your-first-flow), or try
[an issue becoming a tested patch](https://jig.md/guide/tested-patch): selected
local source becomes a reviewable patch with executed checks, while the original
repository stays unchanged.

Jig has three project commands:

```text
jig init --bare <directory>
jig review [project] [--yes]
jig run <flow:path|binding:id> [options]
```

`review` asks you to approve the proposed project changes. `run` executes the
admitted revision and returns JSON after settling owned work. Use
`jig --version` to inspect the installed version.

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
