# Jig

**Build with Agents as naturally as you build with code.**

Skills give Agents instructions and resources for useful work. Jig and FLOW
help you bring that work into your software as executable methods you can
call and combine with ordinary code.

A **Flow** packages a reusable method. When executable, it accepts input and
returns an outcome and result. Its implementation can use code, Agent judgment,
or both. The caller works with the method's contract without adopting its
internal orchestration model.

[FLOW](https://flow.jig.md/) is the independent standard for that package and
invocation boundary. **Jig** is the microkernel-inspired host that runs accepted
methods with operator-chosen powers and accounts for their execution. Methods
own the work; applications own purpose and consequences; Jig owns the common
execution boundaries.

Start with [one caller, three implementations](./docs/jig/examples/contact-import.md):
a contact importer calls a column mapper written as code, an Agent method,
or a combination. Its caller stays unchanged. The shared interface keeps composition
consistent; it does not guarantee equal answers or make Agent judgment correct.

For larger applications, try [a tested patch](./docs/jig/examples/tested-patch.md) or
[support-case handling](./docs/jig/examples/support-case.md).

The shared aspiration is to **expand human possibility**. FLOW pursues
**capability compounding**; Jig pursues **agency through power under control**.
[Why FLOW exists](https://flow.jig.md/guide/understand) and
[how Jig works](./docs/jig/understand/index.md) explain the architecture behind them.

## Quickstart

Jig's current source uses the source-available [Bread License](LICENSE.md): personal non-business
use, genuine evaluation, and business use below US$1m in consolidated group
annual revenue are free. Larger groups need company coverage for operational
use. [Jig's prices](PRICING.md) buy permanent rights to covered releases across
applications, including twelve months of new official releases.

Install the developer alpha on a [supported Linux or Mac host](./docs/jig/start/index.md#supported-host):

```sh
npm install --global @jigging/jig@alpha
jig init hello-jig
cd hello-jig
jig review --allow-resolution-network
jig run flow:flows/hello --input '"Ada"'
```

Read the source and policy during review, then approve the exact revision before running it.
The network flag permits dependency preparation. It gives the Flow no runtime network access.
Expect `status: "succeeded"`, `outcome: "done"`, and `output.message: "Hello, Ada!"`.

Follow [your first Flow](./docs/jig/start/index.md) to change that result and handle a failed run.
Then [call it from your application](./docs/jig/start/application.md), [add an Agent](./docs/jig/build/agents.md), and [compose methods](./docs/jig/build/compose.md).
Later source or policy changes need another review.

For Agent-assisted development, install the [FLOW and Jig authoring skills](./docs/jig/for-agents.md#install-authoring-skills) in your project.
They teach portable Flow design and Jig's project workflow.

## Documentation

- [Documentation home](./docs/jig/documentation.md) — choose a task or learning path.
- [Start here](./docs/jig/start/index.md) — run, call, and change one method.
- [Build](./docs/jig/build/index.md) — compose methods, use files, add effects, and handle results.
- [Understand](./docs/jig/understand/index.md) — learn what the application, method, operator, and host each own.
- [Examples](./docs/jig/examples/index.md) — follow complete applications through their results and checks.
- [Reference](./docs/jig/reference/index.md) — look up settings, limits, APIs, and exact host contracts.
- [Research](./docs/jig/research/index.md) — explore hypotheses separately from supported behavior.
- [FLOW specifications](https://flow.jig.md/)
- [Security](SECURITY.md), [contributing](CONTRIBUTING.md), and [release process](RELEASING.md)

Jig is prerelease software. See the guides for the current supported surface.
Licenses are mapped in [LICENSES.md](LICENSES.md); FLOW's public stewardship is
described in [FLOW governance](https://github.com/jiggy/flow/blob/main/Governance.md).
