---
title: Get started with Jig
---

# Get started with Jig

Jig runs reusable Agent methods with powers you approve. This guide creates
one small Flow and shows the review-and-run loop. For a fuller application,
try [an issue becoming a tested patch](./tested-patch.md).

## Install

On a [supported Linux host](#supported-host):

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
your changes. Declining a review leaves the previous admission intact.
For the unlocked greeting, repeat `jig review --allow-resolution-network` after
editing; code-only edits can require fresh resolution too. An unchanged review
reuses the admitted bytes. An authored lock avoids fresh dependency selection.

Use `flow:<path>` for a package or `binding:<id>` for a configured invocation.
A Binding supplies application settings and exact dependencies; see
[project authoring](../spec/project-sdk.md). Omitting `--input` supplies `{}`.
Use `@FILE` for JSON input from a file and `--timeout 2m` for a longer Run.
See [execution policy](../spec/project-policy.md) for current limits and
lifecycle guarantees.

### Read the result and recover from errors

`jig <command> --help` explains that command's options and examples. Invalid
syntax is diagnosed even when the host cannot execute Runs. Errors identify a
relevant project-relative location where available and suggest a safe next step.
A missing target lists targets from the approved revision; Jig never picks one
for you.

Stdout contains the JSON result, or NDJSON when `--receive` is selected. Stderr
carries diagnostics and, on a terminal, elapsed status and cancellation updates.
Piped stdout remains machine-readable. No spinner or terminal control codes are
required. Ctrl-C requests cancellation; wait for cleanup before starting new
work. An interruption or uncertain result is not permission to blindly retry.

Execution completion is different from task success: a method can execute
correctly and return an application outcome such as `blocked`. Inspect the
outcome, output, and exit status. With `--out`, also inspect the separate
delivery status. Existing output directories are never replaced; choose a new
destination for another Run.

### If retained state cannot be opened

`PROJECT_STATE_INVALID` means `.jig` is incompatible with the current build or
damaged. Reinstalling dependencies does not change that state. Preserve `.jig`
and `jig.lock` for recovery; once prior work is confirmed stopped and cleaned up,
move them outside the project and run `jig review` for fresh approval. Keep the
source and dependency locks. If cleanup is uncertain, recover the owned work
before replacing its state.

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
