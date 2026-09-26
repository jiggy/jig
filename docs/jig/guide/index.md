---
title: Get started with Jig
---

# Get started with Jig

Jig runs methods that use code, Agent judgment, or both through the same
callable boundary. This guide starts with a small code-only Flow and the
review-and-run loop. Then [use one caller with three implementations](./request-triage.md)
to see how Agent work fits into the same model.

## Install

Use a [supported Linux host](#supported-host). Jig is developed primarily on
NixOS with manual maintainer smoke testing, while automated CI test suites and
conformance qualification run on provisioned Ubuntu 24.04 x86_64 with the
isolation prerequisites listed below; a stock Linux installation may need host
configuration. If you do not administer the host, ask its administrator to
check that list before installing. Jig reports missing execution support rather
than weakening isolation.

Install the CLI:

```sh
npm install --global @jigging/jig@alpha
```

npm also installs Jig's exact Bun runtime dependency. You do not need a separate
Bun installation for this tutorial. To use a source checkout,
follow the [development instructions](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell).

## Your first Flow

Create a project, review its changes, approve it, then run its greeting Flow:

```sh
jig init hello-jig
cd hello-jig
jig review --allow-resolution-network
jig run flow:flows/hello --input '"Ada"'
```

During `jig review`, inspect the generated source with your editor and read
the displayed changes and policy. The summary does not replace source review.
The terminal then asks:

```text
Approve this exact revision for execution? [y/N]
```

Enter `y` to authorize that revision, or decline to leave it unapproved. Only
run the next command after approval.

`init` writes ordinary editable files: `jig.ts`, `flows/hello/FLOW.meta.json`,
`flows/hello/package.json`, and `flows/hello/FLOW.ts`, plus a README and empty
Bindings directory. It installs nothing, makes no network requests, and
approves nothing. Use `jig init --bare <directory>` when you want an empty
project instead.

The greeting names the exact FLOW SDK revision tested with its Jig build,
not a moving registry tag. Review resolves and retains
its dependencies privately, so no per-Flow `bun install` is needed.
`--allow-resolution-network` permits dependency-selected network requests
before approval; declining cannot undo those requests. It does not give Runs
network access. Supplied dependency locks remain frozen. See
[dependency review](./dependencies.md) for reusable locked packages.

The generated `FLOW.ts` is ordinary SDK code you can edit:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => {
  const name = typeof run.input === "string" ? run.input : "world";
  return { outcome: "done", output: { message: `Hello, ${name}!` } };
});
```

The result includes `status: "succeeded"`, `outcome: "done"`, and
`output: { "message": "Hello, Ada!" }`, alongside bounded diagnostics.
The input is a JSON string; other input values use `"world"`.
This Flow needs no Agent configuration.

## Make one change

In `flows/hello/FLOW.ts`, change `Hello,` to `Welcome,`. Review and run again:

```sh
jig review --allow-resolution-network
jig run flow:flows/hello --input '"Ada"'
```

Approve the source change only after reviewing it. The new output contains
`{"message":"Welcome, Ada!"}`. Until you approve, runs continue using the
previously accepted version. The network flag has the same dependency-resolution
meaning described above; it does not authorize the Flow to access the network.

You have now created, run, and adapted a method. Next,
[choose an ordinary Agent for this same project](./agents.md), or see
[one caller use code, an Agent, or both](./request-triage.md). The method boundary
stays consistent as the implementation changes. Read [how Jig works](./understand.md)
for the architecture behind it, or try [a tested patch](./tested-patch.md)
for one repair or [a small software factory](./software-factory.md) for a fixed
two-issue set.

## Review, run, improve

![Editable source goes through jig review and approval before jig run executes the accepted revision. Jig validates the result and settles owned work before returning an outcome or failure.](./review-run.svg)

`jig review` leads with added, changed, and removed packages, Bindings, and
execution policy, then lists the targets you can run. Changed fields show their
previous and proposed values; unchanged policy is omitted. Use
`jig review --details` to include that unchanged context. For ACP grants, the
review also names the selected non-secret native client configuration.
Inspect the source with your usual tools, then approve the review. In a
noninteractive environment, `--yes` records your explicit approval; it does not
grant resolution-network permission.

`jig run` uses the approved revision. Edit the source and review again to run
your changes. Declining a review leaves the previously approved revision intact.
For the unlocked greeting, repeat `jig review --allow-resolution-network` after
editing; code-only edits can require fresh resolution too. An unchanged review
reuses the admitted bytes. An authored lock avoids fresh dependency selection.

Use `flow:<path>` for a package or `binding:<id>` for a configured invocation.
Use `jig inspect` to list the approved targets, or `jig inspect <target>` to
read a target's retained schemas and configuration without performing a review.
Inspection also reports whether current local execution identities match that
approval, require review, or could not be verified. It does not check source edits
or promise a later Run will succeed.
A Binding supplies application settings and exact dependencies; see
[project authoring](../spec/project-sdk.md). Omitting `--input` supplies `{}`.
Use `@FILE` for JSON input from a file and `--timeout 2m` for a longer Run.
See [execution policy](../spec/project-policy.md) for current limits and
lifecycle guarantees.

## Read the result

The greeting returns execution status, the method's outcome, and its output.
Other methods can complete execution successfully while returning an application
outcome such as `blocked`. Inspect the outcome as well as the CLI exit status.

Terminal stdout shows a readable result; redirected stdout or `--json` carries
the machine-readable result. Stderr carries diagnostics and status. Ctrl-C
requests cancellation. Wait for cleanup before starting new work, and do not
blindly retry an interrupted or uncertain operation.

See [results and recovery](./results.md) for output delivery, scripting,
protocol failures, and retained-state recovery.

## Next steps

Add a second Flow from the project directory:

```sh
jig new summarize
```

Edit `flows/summarize/FLOW.ts`, then use the ordinary
`jig review` and `jig run flow:flows/summarize` path. This creates source only:
no installation, approval, or execution. Default discovery includes the new
directory; if you selected explicit members in `jig.ts`, add it there first.
Dependency resolution still requires your explicit network permission when
needed, as described in [dependencies](./dependencies.md).

- [Add an ordinary Agent](./agents.md) in the project you just created.
- [Compose code and Agent methods](./request-triage.md) through one caller.
- [Run a Markdown method](./markdown.md) without an SDK dependency.
- [Choose an Agent](./agents.md) using an API or a supported local client.
- [Work with files](./files.md) to capture inputs and export one result packet.
- [Configure Jig](./configuration.md) for terminal appearance, startup verification, and operator settings.
- [Manage dependencies](./dependencies.md) for reusable Flow packages.
- [Author contracts once](./contracts.md) to generate validation and editor types together.
- [Repair a project](./tested-patch.md), run a [small software factory](./software-factory.md),
  or [handle a disputed charge](./support-case.md).
- [Choose a workflow structure](./workflow-design.md) for your application.

## Supported host

Jig requires a Linux x86_64 environment with container isolation facilities.
Jig is developed primarily on NixOS, which serves as the maintainer's primary
manual smoke-testing environment. Automated CI test suites and host conformance
qualification run on provisioned Ubuntu 24.04 x86_64. Manual smoke testing on
NixOS and automated CI runs on Ubuntu do not establish macOS, Windows, or aarch64
support. Jig checks required invocation contracts and reports missing support.

- Linux x86_64, glibc 2.17 or newer, and an SSE4.2-capable CPU.
- Bubblewrap 0.12 or newer and GNU `readlink -f`.
- cgroup v2 with delegated `cpu`, `memory`, and `pids` controllers.
- A systemd user manager supporting transient scopes with `Delegate=yes`.
- Unprivileged user, mount, PID, network, IPC, UTS, and cgroup namespaces.

Jig's host-tool lookup currently uses `/usr/bin`, `/bin`, and
`/run/current-system/sw/bin`. An absolute `JIG_BWRAP_PATH` selects another
Bubblewrap installation. The host validates the selected tool; an invalid
explicit selection fails rather than falling back.

On NixOS, enable `programs.nix-ld.enable` for npm's runtime binary. Jig resolves
glibc through `/run/current-system/sw/share/nix-ld/lib/ld.so` and gives Runs
only the required loader and libraries. Automated CI conformance on NixOS
remains unconfigured.

`review` and `run` acquire their delegated scopes without `sudo`. Jig verifies
the package-local Bun runtime before execution. See the
[security boundary](https://github.com/jiggy/jig/blob/main/SECURITY.md) for
isolation details and the private reporting channel.
