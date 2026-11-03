---
title: Run your first Flow
description: Install Jig, run an accepted method, and change its result.
---

# Run your first Flow

Run a small method, read its result, and change what it does.
This first Flow uses code and needs no Agent account.
Next, you will call the same method from an application.

A **Flow** is a reusable method with an input, an outcome, and output.
Jig runs its accepted revision with reviewed powers and limits.
The method can use code, Agent judgment, or both.

## Before you start

Use a [supported Linux or Mac host](#supported-host) and npm.
Linux may need administrator configuration.
The qualified Mac path needs no `sudo` or administrator setup.
Jig refuses missing execution support instead of weakening its boundary.

Install the developer alpha:

```sh
npm install --global @jigging/jig@alpha
```

npm installs Jig's exact Bun runtime dependency.
You do not need a separate Bun installation for this tutorial.
For source development, use the [development instructions](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell).

## 1. Create the project

```sh
jig init hello-jig
cd hello-jig
```

`init` creates ordinary editable source, including `jig.ts`, a greeting Flow, and an empty Bindings directory.
It installs nothing, makes no network requests, and approves nothing.

Open `flows/hello/FLOW.ts`:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => {
  const name = typeof run.input === "string" ? run.input : "world";
  return { outcome: "done", output: { message: `Hello, ${name}!` } };
});
```

The generated `flows/hello/package.json` declares the exact FLOW SDK revision tested with this Jig build.
Keep that dependency beside the Flow.
An application-root dependency does not replace the Flow's declaration.

## 2. Review and approve

```sh
jig review --allow-resolution-network
```

Inspect the generated source with your editor.
Read the displayed package changes, execution policy, and available targets.
The summary does not replace source review.

The resolution flag permits dependency-selected network requests before approval.
Declining cannot undo those requests.
It grants no network access to Runs and does not update supplied dependency locks.
See [dependency preparation](../build/dependencies.md#fresh-resolution-and-network-access) before using it with unfamiliar packages.

Jig then asks:

```text
Approve this exact revision for execution? [y/N]
```

Enter `y` to authorize that revision.
Declining leaves it unapproved.
Review prepares and retains dependencies privately, so this tutorial needs no per-Flow installation.

## 3. Run and read the result

After approval:

```sh
jig run flow:flows/hello --input '"Ada"'
```

Expect these fields in the result:

```json
{
  "status": "succeeded",
  "outcome": "done",
  "output": { "message": "Hello, Ada!" }
}
```

Additional fields report diagnostics, delivery, and cleanup.
`status` describes execution.
`outcome` describes the method's answer.
Other methods can complete successfully with outcomes such as `blocked` or `limit`.
Your application must inspect both.

Terminal stdout shows a readable result.
Redirected stdout or `--json` carries machine-readable JSON.
Stderr carries diagnostics and status.
This result-only method creates no result packet unless you request one with `--out`.

## 4. Change the greeting

In `flows/hello/FLOW.ts`, replace `Hello,` with `Welcome,`.
Review the change and run again:

```sh
jig review --allow-resolution-network
jig run flow:flows/hello --input '"Ada"'
```

Approve only after inspecting the source change.
Expect `{"message":"Welcome, Ada!"}`.
Until approval, Runs continue using the previously accepted revision.

Code edits can need fresh dependency resolution when no authored lock exists.
An unchanged review reuses admitted bytes.
[Manage dependencies](../build/dependencies.md) explains authored locks and reusable libraries.

## If the first run fails

For host support, review, input, or execution failures, see [Troubleshooting](../reference/troubleshooting.md).

Ctrl-C requests cancellation.
Wait for cleanup before starting new work.
Do not automatically repeat an interrupted or uncertain operation.

## Continue from the result

[Call this Flow from your application](./application.md) to consume its output from code.
Then [choose an Agent](../build/agents.md) and [compose methods](../build/compose.md).
The [contact importer](../examples/contact-import.md) demonstrates code, Agent, and mixed implementations behind one calling boundary.

For Agent-assisted development, install the [FLOW and Jig authoring skills](../for-agents.md#install-authoring-skills).
See [How Jig works](../understand/index.md) for the responsibilities behind review, execution, and cleanup.

## Supported host

Jig qualifies Linux x86_64 and selected native Macs. It checks the exact host
mechanism before execution and refuses unqualified kernels or missing support.

On Linux, Jig is developed primarily on NixOS and qualified in automated CI on
provisioned Ubuntu 24.04 x86_64. This host needs:

- Linux x86_64, glibc 2.17 or newer, and an SSE4.2-capable CPU.
- Bubblewrap 0.12 or newer and GNU `readlink -f`.
- cgroup v2 with delegated `cpu`, `memory`, and `pids` controllers.
- A systemd user manager supporting transient scopes with `Delegate=yes`.
- Unprivileged user, mount, PID, network, IPC, UTS, and cgroup namespaces.

On Mac, Jig selects Intel Darwin 23.4.0 build 23E224, Intel/Apple Silicon Darwin 24.6.0 build 24G830, and Apple Silicon Darwin 24.6.0 build 24H232.
Each released profile requires complete native qualification. Other kernel builds are unsupported.

Install through the same npm command above. npm selects the matching pinned Bun runtime. No privileged
helper, managed execution account, separate Bun installation, or `sudo` is
required. Jig uses a private native sandbox and an owned process coalition to
contain and stop work. Resource limits are supervised and sampled on Mac, so
CPU, memory, and process use can briefly exceed the requested ceiling before
Jig terminates the scope. See the [security boundary](https://github.com/jiggy/jig/blob/main/SECURITY.md)
when deciding whether this tradeoff fits your workload.

Linux and Apple Silicon checks must pass before a release is published. Intel
Mac support has complete nightly compatibility checks, so a new release can
contain an Intel regression before the next check. See the
[Intel compatibility policy](https://github.com/jiggy/jig/blob/main/RELEASING.md#intel-mac-compatibility)
for the tested versions, results and manual checks.

Jig's host-tool lookup currently uses `/usr/bin`, `/bin`, and
`/run/current-system/sw/bin`, not your shell's `PATH`.
If Bubblewrap is installed elsewhere, configure its absolute path before review.
See [host configuration](../reference/configuration.md#host-configuration) for the command.
The host validates the selected tool. An invalid explicit selection fails
rather than falling back.

On NixOS, enable `programs.nix-ld.enable` for npm's runtime binary. Jig resolves
glibc through `/run/current-system/sw/share/nix-ld/lib/ld.so` and gives Runs
only the required loader and libraries. Automated CI conformance on NixOS
remains unconfigured.

`review` and `run` acquire their delegated scopes without `sudo`. Jig verifies
the package-local Bun runtime before execution. See the
[security boundary](https://github.com/jiggy/jig/blob/main/SECURITY.md) for
isolation details and the private reporting channel.
