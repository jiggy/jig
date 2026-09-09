# Jig and FLOW

**Accomplish more. Keep the controls.**

Jig puts reusable expertise to work with Agents you choose. Combine capable
methods, inspect their results, and decide what powers they can use.
[FLOW](https://flow.jig.md/) is the independent standard for sharing those
methods: executable know-how others can run, adapt, and build on.

The shared aspiration is to **expand human possibility**. FLOW pursues
**capability compounding**; Jig pursues **agency through power under control**.
Methods own their procedures, applications own their purpose, and the small
Jig host owns authorized execution. You do not need a dedicated host feature
for every workflow method.

[How Jig works](docs/jig/guide/understand.md) ·
[Why FLOW exists](docs/flow/guide/understand.md)

Start with [an issue becoming a tested patch](docs/jig/guide/tested-patch.md):
describe a bug in a small TypeScript project and receive a reviewable patch
with executed checks. Your original repository stays unchanged; you decide
whether to apply the result.

Or try [the proposal workshop](docs/jig/guide/proposal-workshop.md), which
combines reusable drafting and review specialists over supplied evidence.
These are working applications, not claims that every model-generated result
will be correct.

## Quickstart

Install the developer alpha on a [supported Linux host](docs/jig/guide/index.md#supported-host):

```console
npm install --global @jigging/jig@alpha
```

Follow [your first Flow](docs/jig/guide/index.md#your-first-flow) for a complete
small project, or copy the [tested-patch application](examples/tested-patch).

Inside the greeting project from the first-Flow guide, the everyday loop is:

```console
jig review
jig run flow:flows/hello --input '{"name":"Ada"}'
```

`review` shows the proposed changes and asks for approval. `run` executes the
approved revision, returns its result, and settles owned work. Later source
changes need another review.

## Documentation

- [Get started and supported hosts](docs/jig/guide/index.md)
- [Choose an Agent](docs/jig/guide/agents.md)
- [Working with files](docs/jig/guide/files.md) and [dependencies](docs/jig/guide/dependencies.md)
- [Workflow design](docs/jig/guide/workflow-design.md) and [use cases](docs/jig/use-cases.md)
- [Project authoring](docs/jig/spec/project-sdk.md) and [execution policy](docs/jig/spec/project-policy.md)
- [FLOW specifications](https://flow.jig.md/)
- [Security](SECURITY.md), [contributing](CONTRIBUTING.md), and [release process](RELEASING.md)

Jig is prerelease software. See the guides for the current supported surface.
Licenses are mapped in [LICENSES.md](LICENSES.md); FLOW's public stewardship is
described in [Governance.md](Governance.md).
