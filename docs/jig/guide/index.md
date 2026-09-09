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

npm also installs Jig's exact Bun runtime dependency. Creating dependency locks
in this tutorial uses Bun 1.3.3 as an authoring tool. To use a source checkout,
follow the [development instructions](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell).

## Your first Flow

Create a project:

```console
jig init --bare hello-jig
cd hello-jig
mkdir -p flows/hello
```

Create `flows/hello/FLOW.md`, which explains what the package does:

```markdown
---
name: hello
description: Return a greeting for the supplied name.
---

# Hello
```

Create `flows/hello/package.json` to select the FLOW SDK:

```json
{
  "private": true,
  "dependencies": { "@jigging/flow": "0.1.0-alpha.8" }
}
```

Create `flows/hello/flow.ts`:

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

Generate its dependency lock:

```console
cd flows/hello
bun install --lockfile-only
cd ../..
```

Review the project, approve it, then run the Flow:

```console
jig review
jig run flow:flows/hello --input '{"name":"Ada"}'
```

The result includes `status: "succeeded"`, `outcome: "done"`, and
`output: { "message": "Hello, Ada!" }`, alongside bounded diagnostics.
This Flow needs no Agent configuration.

## Review, run, improve

![Editable source goes through jig review and approval before jig run executes the accepted revision. Jig validates the result and settles owned work before returning an outcome or failure.](./review-run.svg)

`jig review` displays the proposed project changes and package identities.
Inspect the source with your usual tools, then approve the review. In a
noninteractive environment, `--yes` records your explicit approval.

`jig run` uses the approved revision. Edit the source and review again to run
your changes. Declining a review leaves the previous admission intact.

Use `flow:<path>` for a package or `binding:<id>` for a configured invocation.
A Binding supplies application settings and exact dependencies; see
[project authoring](../spec/project-sdk.md). Omitting `--input` supplies `{}`.
Use `@FILE` for JSON input from a file and `--timeout 2m` for a longer Run.
See [execution policy](../spec/project-policy.md) for current limits and
lifecycle guarantees.

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
