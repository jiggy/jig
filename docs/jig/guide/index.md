---
title: Get started with Jig
---

# Get started with Jig

Jig runs reusable Agent methods with powers you approve. This guide creates
one small Flow and shows the review-and-run loop. For a fuller application,
try [an issue becoming a tested patch](./tested-patch.md).

## Install

Use a [supported Linux host](#supported-host). The qualified environment is
Ubuntu 24.04 x86_64 with the isolation prerequisites listed below; a stock
Linux installation may need host configuration. If you do not administer the
host, ask its administrator to check that list before installing. Jig reports
missing execution support rather than weakening isolation.

Install the CLI:

```console
npm install --global @jigging/jig@alpha
```

npm also installs Jig's exact Bun runtime dependency. You do not need a separate
Bun installation for this tutorial. To use a source checkout,
follow the [development instructions](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell).

## Your first Flow

Create a project, review its changes, approve it, then run its greeting Flow:

```console
jig init hello-jig
cd hello-jig
jig review --allow-resolution-network
jig run flow:flows/hello --input '{"name":"Ada"}'
```

During `jig review`, inspect the generated source with your editor and read
the displayed changes and policy. The summary does not replace source review.
The terminal then asks:

```text
Approve this exact revision for execution? [y/N]
```

Enter `y` to authorize that revision, or decline to leave it unapproved. Only
run the next command after approval.

`init` writes ordinary editable files: `jig.ts`, `flows/hello/FLOW.md`,
`flows/hello/package.json`, and `flows/hello/flow.ts`, plus a README and empty
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

The generated `flow.ts` is ordinary SDK code you can edit:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => {
  const name = typeof run.input === "object" && run.input !== null &&
      !Array.isArray(run.input) && typeof run.input.name === "string"
    ? run.input.name
    : "world";
  return { outcome: "done", output: { message: `Hello, ${name}!` } };
});
```

The result includes `status: "succeeded"`, `outcome: "done"`, and
`output: { "message": "Hello, Ada!" }`, alongside bounded diagnostics.
This Flow needs no Agent configuration.

## Make one change

In `flows/hello/flow.ts`, change `Hello,` to `Welcome,`. Review and run again:

```console
jig review --allow-resolution-network
jig run flow:flows/hello --input '{"name":"Ada"}'
```

Approve the source change only after reviewing it. The new output contains
`{"message":"Welcome, Ada!"}`. Until you approve, runs continue using the
previously accepted version. The network flag has the same dependency-resolution
meaning described above; it does not authorize the Flow to access the network.

You have now created, run, and adapted a method. To put an Agent to work,
continue with [a tested patch](./tested-patch.md). To understand the few parts
behind that loop, read [how Jig works](./understand.md).

## Review, run, improve

![Editable source goes through jig review and approval before jig run executes the accepted revision. Jig validates the result and settles owned work before returning an outcome or failure.](./review-run.svg)

`jig review` leads with added, changed, and removed packages, Bindings, and
execution policy, then lists the targets you can run. Changed policy is shown
in full; unchanged policy is omitted. When proposing a change, use
`jig review --details` to inspect complete current and proposed policy. If Agent capabilities are used, the
review also names the selected non-secret host Agent configuration.
Inspect the source with your usual tools, then approve the review. In a
noninteractive environment, `--yes` records your explicit approval; it does not
grant resolution-network permission.

`jig run` uses the approved revision. Edit the source and review again to run
your changes. Declining a review leaves the previously approved revision intact.
For the unlocked greeting, repeat `jig review --allow-resolution-network` after
editing; code-only edits can require fresh resolution too. An unchanged review
reuses the admitted bytes. An authored lock avoids fresh dependency selection.

Use `flow:<path>` for a package or `binding:<id>` for a configured invocation.
A Binding supplies application settings and exact dependencies; see
[project authoring](../spec/project-sdk.md). Omitting `--input` supplies `{}`.
Use `@FILE` for JSON input from a file and `--timeout 2m` for a longer Run.
See [execution policy](../spec/project-policy.md) for current limits and
lifecycle guarantees.

## Read the result

The greeting returns execution status, the method's outcome, and its output.
Other methods can complete execution successfully while returning an application
outcome such as `blocked`. Inspect the outcome as well as the CLI exit status.

Stdout carries the machine-readable result; stderr carries diagnostics. Ctrl-C
requests cancellation. Wait for cleanup before starting new work, and do not
blindly retry an interrupted or uncertain operation.

See [results and recovery](./results.md) for output delivery, scripting,
protocol failures, and retained-state recovery.

## Next steps

- [Choose an Agent](./agents.md) using an API or a supported local client.
- [Work with files](./files.md) to capture inputs and export one result packet.
- [Manage dependencies](./dependencies.md) for reusable Flow packages.
- [Repair a project](./tested-patch.md) or [compose a proposal workshop](./proposal-workshop.md).
- [Choose a workflow structure](./workflow-design.md) for your application.

## Supported host

The alpha has independent host evidence on provisioned Ubuntu 24.04 x86_64.
Other matching Linux hosts are not yet independently validated. Jig checks
required capabilities and reports missing support.

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
only the required loader and libraries. Independent NixOS conformance remains
unverified.

`review` and `run` acquire their delegated scopes without `sudo`. Jig verifies
the package-local Bun runtime before execution. See the
[security boundary](https://github.com/jiggy/jig/blob/main/SECURITY.md) for
isolation details and the private reporting channel.
