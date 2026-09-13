# Jig and FLOW

**Code and Agents. One way to build.**

Agents help you build software. Jig and FLOW help you put their intelligence
inside it, alongside ordinary code, through the same composable methods.

A **Flow** packages a reusable method. When executable, it accepts input and
returns an outcome and result. Its implementation can use code, Agent judgment,
or both. The caller works with the method's contract without adopting its
internal orchestration model.

[FLOW](https://flow.jig.md/) is the independent standard for that package and
invocation boundary. **Jig** is the microkernel-inspired host that runs accepted
methods with operator-chosen powers and accounts for their execution. Methods
own the work; applications own purpose and consequences; Jig owns the common
execution boundaries.

Start with [one caller, three implementations](docs/jig/guide/request-triage.md):
an intake method calls a classifier written as code, an Agent method, or a
combination. Its caller stays unchanged. The shared interface keeps composition
consistent; it does not guarantee equal answers or make Agent judgment correct.

For larger applications, try [a tested patch](docs/jig/guide/tested-patch.md) or
[the proposal workshop](docs/jig/guide/proposal-workshop.md).

The shared aspiration is to **expand human possibility**. FLOW pursues
**capability compounding**; Jig pursues **agency through power under control**.
[Why FLOW exists](docs/flow/guide/understand.md) and
[how Jig works](docs/jig/guide/understand.md) explain the architecture behind them.

## Quickstart

Install the developer alpha on a [supported Linux host](docs/jig/guide/index.md#supported-host):

```sh
npm install --global @jigging/jig@alpha
```

Follow [your first Flow](docs/jig/guide/index.md#your-first-flow) for a complete
small project, or copy the [tested-patch application](examples/tested-patch).

Inside the greeting project from the first-Flow guide, the everyday loop is:

```sh
jig review --allow-resolution-network
jig run flow:flows/hello --input '"Ada"'
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
