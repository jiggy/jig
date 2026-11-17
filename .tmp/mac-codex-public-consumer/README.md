# One-off ordinary installed Codex startup consumer

This ignored, maintainer-authored diagnostic uses only public Jig/Flow/ACP imports
inside its generated ordinary project and application driver. It is not an
independent usability probe. It never uses an original incident ticket or state.

The Flow calls the public finite-ACP resource, receives its genuine ready record,
then sends only `initialize` and `session/new`. Jig mediates the adapter's private
local authentication configuration. The Flow saves a public Run Checkpoint after
a genuine session ID arrives and waits. It never sends `session/prompt` or copies
the native session ID into public output.

The ordinary application persists its complete fresh Prepared value, submits its
exact request once, observes the accepted checkpoint, cancels that identity once,
and requires a `CANCELLED` terminal with confirmed cleanup. This is intentional
cancellation, not successful zero-turn finite-ACP completion. The public contract
forbids treating initialization alone as successful resource settlement.

An HTTPS loopback listener is the selected ordinary API endpoint. It never returns
a provider result. Any TCP connection, TLS session, or HTTP request to that endpoint
fails this diagnostic. The placeholder API key is not a real credential. This
proves neither provider authentication nor inference. Public ACP uses inherited
network authority; zero traffic at the selected endpoint does not prove kernel
network isolation or absence of traffic to every other destination.

## Prepare without submitting work

Use qualified Bun 1.4.4, Node 24, Git, tar and OpenSSL on PATH.
Preparation can run on Linux; driver execution requires native ARM macOS 15 or 26. The genuine Codex executable
must match the startup qualification's selected binary. Supply the exact same
canonical candidate archive bytes used by the host qualification:

```sh
export JIG_PACKAGE_ARCHIVE=/absolute/canonical/jig/archive.tgz
export FLOW_SDK_PACKAGE_ARCHIVE=/absolute/canonical/flow-sdk/archive.tgz
export AGENT_ACP_PACKAGE_ARCHIVE=/absolute/canonical/agent-acp/archive.tgz
export AGENT_METHOD_PACKAGE_ARCHIVE=/absolute/canonical/agent-method/archive.tgz
bun prepare.mjs /private/tmp/ordinary-codex-startup-UNIQUE
```

The destination must be fresh and outside the repository. Setup has an eight-minute
aggregate allowance and a two-minute per-command ceiling. It installs the archives
normally, imports both contracts through the installed public CLI, and freezes the
ordinary source-workspace lock. The unchanged Agent Method archive supplies the ACP
workspace’s declared development dependency; the consumer calls no Agent Method.
Setup uses a new fixture-owned empty HOME and disables npm user configuration.
It does not review, prepare or submit a Run. Unexpected protected project state
causes setup to fail.
Dependency installation may use the package registry. Failures name a closed
phase, command index, status and signal. Raw stdout/stderr stay in private
`evidence/setup-NNN.stdout.txt` and `.stderr.txt` files; do not upload them. The loopback key is generated
locally and stays in the private workspace; never upload it.

## Execute only after this diagnostic is reviewed

```sh
export JIG_CODEX_STARTUP_PATH=/absolute/genuine/codex
bun /private/tmp/ordinary-codex-startup-UNIQUE/driver.ts
```

The driver does public review once, with a two-minute ceiling. The fresh execution
has a four-minute Run deadline; its owner transport has five minutes. Checkpoint
observation has ninety seconds, and cancellation settlement has ninety seconds.
Each public observation/cancel call has a ten-second transport bound. The Flow is
held only until this exact new identity is explicitly cancelled.

Keep the whole workspace after failure. `evidence/prepared.json` contains a private
fresh ticket; do not attach it to GitHub. Never retry submission, repeat cancellation,
reset `.jig`, or rerun `driver.ts` in that workspace. If a call is uncertain, inspect
the saved fresh identity through bounded read-only public operations. A new diagnostic
requires a separately reviewed fresh workspace and identity.

Successful evidence is `evidence/summary.json`, with the public checkpoint and
terminal observations retained privately. Before claiming native residue cleanup,
also compare the surrounding sequential host job/mount/process observations. The
public cleanup result is the product's confirmed result, not an independent
host-residue inspection.

Linux preparation passed all nine setup commands against the verified canonical
candidate, with a fresh fixture-owned HOME. No review, driver, native client, Run
or model turn was executed. All four canonical archive hashes remained unchanged.
