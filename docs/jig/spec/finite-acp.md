# Finite ACP resource

This invocation connects an ordinary Agent Flow to one host-authorized native
ACP conversation. The Flow owns the procedure and interprets its answer. The
host owns the native process, private authentication, reviewed configuration,
allowed dispatch, deadlines and cleanup. This is a finite protocol resource,
not unrestricted process I/O or a general Agent service.

The [invocation descriptor](https://jig.md/contracts/finite-acp/contract.json) and its
[requests](https://jig.md/contracts/finite-acp/requests.json) and
[responses](https://jig.md/contracts/finite-acp/responses.json) channel agreements form one
exact offline bundle. Identity matching is offline; the
identifier URLs neither fetch implementations nor grant authority. Client
availability remains a host-profile qualification, not a descriptor promise.

## One invocation, two direct channels

An ordinary Agent package requires this interface through a named slot. Its
Binding selects the native client through an ordinary resource grant:

```ts
defineBinding({
  package: 'flows/agent',
  slots: { native: { kind: 'acp', client: 'codex' } },
})
```

The host qualifies that exact client using operator configuration captured
before project loading. Review identifies the recipient, client, model,
authentication mode and executable. No global Agent selection, guessed slot
name or Flow-authored environment creates this authority. Changed runtime
identity requires renewed review; the launch still revalidates its artifacts.

Input is `null`. Both channels are required and direct: the resource receives
`requests` and sends `responses`. The adapter creates the channels through the
ordinary SDK and transfers the opposite endpoints in one exact slot call:

```ts
const requests = await run.channel({ contract: './contracts/finite-acp/requests.json' })
const responses = await run.channel({ contract: './contracts/finite-acp/responses.json' })
const resource = run.call({
  operationId: 'native', slot: 'native', input: null,
  channels: { requests: requests.receive, responses: responses.send },
})
```

The caller must consume responses while sending requests and await `resource`.
Neither channel EOF nor a completed ACP prompt proves resource settlement.

The first response is exactly one non-secret ready record:

```json
{
  "kind": "ready", "protocolVersion": 1, "cwd": "/work",
  "configuration": [{ "configId": "model", "value": "reviewed-model" }],
  "modeId": "read-only"
}
```

`configuration` is an ordered array, possibly empty. String settings use
`{configId,value}`; Boolean settings use `{configId,type:"boolean",value}`.
Configuration IDs are unique; at most 16 are supplied. Identifiers and string
values are nonempty Unicode scalar text, contain no NUL, and are at most 1,024
UTF-8 bytes. `modeId` is optional. The complete ready item must fit 64 KiB.
Fields are closed: no credential, executable path, authentication request,
provider endpoint or unrestricted client metadata belongs here.

Ready means the reviewed transport is armed, not that ACP initialization,
authentication or the Agent task succeeded. It reflects the same immutable
configuration the host independently enforces. Editing the received value or
copying another ready record cannot change dispatch authority.

## Bounded text framing

Subsequent responses and all requests use the same fragment shape:

```json
{ "kind": "data", "text": "part of one JSON frame", "end": false }
```

Concatenate `text` in received order until `end:true`. That closes one complete
ACP JSON/1 frame. There is only one partial frame per direction; frames cannot
interleave. Text chunks are nonempty, at most 8,192 UTF-8 bytes, and cut only
between Unicode scalars. This leaves room for JSON escaping within the common
64 KiB channel item bound. Transport is not binary and has no fragment replay,
independent chunk identity, or reconnect mechanism.

| Bound | Requests | Responses |
| --- | --- | --- |
| One reassembled frame | 16 MiB | 16 MiB |
| Cumulative reassembled bytes | 8 MiB | 32 MiB |
| Complete frames | 32 | 8,192 |
| Fragments, including partial frames | 16,384 | 16,384 |

Count received bytes before allocating additional reassembly storage. Malformed
framing, an exceeded limit or EOF inside a frame fails the stream permanently.
Receiving a fragment does not establish dispatch. The host validates complete
JSON/1, finite protocol state and reviewed authority before forwarding the
frame; its operation allowance is consumed before any possibly uncertain write.

These bounded text fragments use ordinary FLOW channels. Jig's common source
lifetime limit is 64 MiB, including envelope bytes; its 64 KiB item, 256 KiB
queue and 16 pending-send limits still apply. No native-only exemption permits
an unbounded queue. The larger cumulative allowance preserves the existing
bounded native text response when its necessary framing crosses a Flow boundary.

## Finite ACP authority profile

The host accepts one serial sequence, with unique bounded request IDs:

1. ACP `initialize` at version 1, without client tool or authentication powers.
2. One `session/new` at `/work`, with an empty `mcpServers` array and no `_meta`.
3. Each exact ready configuration transition, in order, with confirmation of
   its reviewed value; then the exact mode transition if present.
4. One `session/prompt` on the owned session containing one text block, at most
   1 MiB. NUL and a leading slash-command interpretation are excluded.
5. Optional `session/close` if the initialized client advertised it.

After the prompt is dispatched, at most one `session/cancel` notification may
name that owned session. It cannot settle pending work by itself. Session IDs
come from the correlated `session/new` response, never from a notification.
Extra prompts, sessions, provider selection, authentication, tools, filesystem
requests, mode changes, session replacement and metadata are rejected. Native
permission requests receive the host's fixed cancelled answer, not a choice
made by the editable adapter.

Only correlated results, a constant sanitized request error, public assistant
text and public plan updates reach the adapter. Unneeded native fields are
withheld. One conversation permits at most 4,096 updates, 8 MiB of assistant
text and 256 permission requests; raw native protocol ingress remains bounded
at 32 MiB before projection. The host accounts for ignored frames too.

Protocol accounting is not containment. An approved native executable still
receives the required private authentication and may require network access.
The host must qualify and retain its launch profile independently; this
contract does not make arbitrary credential-bearing code safe. Secret bootstrap
stays outside the adapter channel. A client requiring secret-bearing ACP
authentication needs separately implemented host mediation before it qualifies.

## Settlement and failure

Clean request EOF is eligible only after the finite protocol has settled.
The host ends native input and waits for owned process cleanup, using bounded
controlled termination if needed. Successful resource output contains actual
process evidence:

```json
{
  "outcome": "done",
  "output": {
    "stopReason": "closed", "exitCode": null,
    "signal": "SIGTERM", "cleanup": "complete"
  }
}
```

`stopReason:"exited"` denotes an observed process exit; the Agent adapter
requires exit zero without a signal. `"closed"` denotes closure requested by
the clean, settled request stream, followed by controlled process cleanup.
Its nullable exit code and signal report what happened, not invented success.
Root cancellation, deadline, uncertain ownership, failed cleanup, unauthorized
dispatch and broken essential transport remain invocation errors; they cannot
be relabelled `closed`.

Response framing must finish and its writer must close before the resource
returns. Essential channel failure cancels/fences the resource and waits for
owned work to settle. No uncertain operation is retried. Process settlement,
ACP stop reason and the application-checked Agent answer remain distinct.
The host does not reconstruct an Agent answer in this resource result.

## Optional presentation is separate

The Agent Flow may project selected updates into its optional `events` channel.
That channel is not either essential transport channel. Display failure must
not manufacture Agent success or lose the execution result.

The ordinary adapter uses a bounded relay. After a rejected write,
oversized item, full local queue or 500 ms blocked send, it discards the entire
remaining suffix, reports a fixed incomplete-progress diagnostic and declares
an abnormal writer end through `close({error:"LAGGED"})`. Active receivers
receive the sticky stream failure using ordinary language recovery. It never
resumes after an unmarked gap. A committed read remains valid; queued uncommitted
items can be discarded. The producer declaration is incomplete-observation
evidence, not an Agent or process result. No private host access is needed.

## Native client profiles

The finite resource supports the following reviewed native client profiles.
Each client contributes only the configuration needed to launch its own ACP
adapter:

| Client | Host selection | Subscription configuration | API configuration |
| --- | --- | --- | --- |
| Codex | `{ kind: 'acp', client: 'codex' }`; optional absolute `CODEX_PATH` | Operator-owned, file-backed `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`), created by `codex login`; optional `CODEX_MODEL`, with omission retaining the client default | `OPENAI_API_KEY` and `OPENAI_MODEL`; optional `OPENAI_BASE_URL`; `OPENAI_API` must be omitted or `responses` |
| Claude Code | `{ kind: 'acp', client: 'claude' }`; optional absolute `CLAUDE_PATH` | `CLAUDE_CODE_OAUTH_TOKEN`; optional `CLAUDE_MODEL` | Exactly one of `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, plus `ANTHROPIC_MODEL`; optional `ANTHROPIC_BASE_URL` |
| Pi | `{ kind: 'acp', client: 'pi' }`; optional absolute `PI_PATH` | `PI_PROVIDER` and `PI_MODEL`; authentication from `PI_CODING_AGENT_DIR/auth.json` or `~/.pi/agent/auth.json` | `PI_PROVIDER`, `PI_MODEL`, and `PI_API_KEY`, using a provider implemented by Pi |

The current Pi profile accepts the official self-contained Linux x64 Pi
0.84.4 release layout. It does not interpret the multi-file npm installation
or make Node part of Jig's runtime closure.

Jig snapshots the operator environment before loading project code. An explicit
`CODEX_PATH`, `CLAUDE_PATH`, or `PI_PATH` selects that client's executable and
must be an absolute path; an invalid override fails without fallback. Otherwise,
Jig searches the operator's `PATH` in order for `codex`, `claude`, or `pi`.
Empty and relative entries are ignored. Implicit discovery excludes the project
tree and ancestor `node_modules` directories, including symlink routes through
those locations. Operator-managed symlinks are supported. Shell aliases are not
executables, and discovery does not make shell wrappers or JavaScript launchers
supported native clients.

The selected regular executable and client-specific support files receive the
same validation and identity checks with either selection method. Invalid client
support fails without trying another installation. Review shows
the native client and its resolved operator executable path. Launch uses the
resolved executable checked against admitted provider identity, without repeating
host PATH discovery. A changed selection cannot silently replace reviewed
executable or support bytes.

All three native adapters inspect Linux x86-64 ELF executables. Codex and
Claude Code also accept the declarative `makeBinaryWrapper` form which preserves
arguments and prefixes PATH; Pi requires its unwrapped standalone executable.
Arbitrary shell/JavaScript wrappers, wrapper flags or environment changes, and nested
wrappers are unsupported. Jig reads installation metadata without executing the
client during review. It retains the wrapped executable, ELF interpreter, and
transitive shared libraries as individual regular files at their installation
paths. Library resolution uses ELF RUNPATH/RPATH, `$ORIGIN`, the selected
interpreter’s directory (including its canonical location), and supported Linux
loader locations; it does not import ambient loader variables or whole runtime
directories. Missing, malformed, project-selected, or unsupported dependencies
fail closed. Each executable's runtime dependency walk is bounded to 128 file
destinations. Pi's matching manifest and themes remain beside its native
executable and cannot be selected through the project tree. Bun's private loader
settings are removed before each native client starts, so its libraries use
the reviewed installation's ABI.

For Codex's nested sandbox, Jig selects the first eligible unprivileged `bwrap`
from the wrapper's declared PATH prefix followed by operator PATH, with the
same project and dependency-directory exclusions as client discovery. With no
eligible helper, it selects the installation's matching `codex-resources/bwrap`
beside the executable directory or its parent. A PATH-selected helper is never
substituted at the vendor bundle path. `JIG_BWRAP_PATH` selects only Jig's outer
containment tool. Executable, wrapper, helper, shared-library bytes, and their
contained paths enter provider identity and are revalidated before launch.
A bundled fallback stays off PATH so Codex applies its vendor integrity check.
For a PATH-selected helper, only its directory enters the initial contained
PATH; other operator PATH entries do not become filesystem authority.

Subscription mode requires Codex's `cli_auth_credentials_store = "file"`
setting. Jig reads the current operator's file during review and Run, validates
it, discards its refresh token, and gives the contained client only a
short-lived non-refreshable bearer. It never embeds a development credential
or mounts the operator's `CODEX_HOME`. A keyring-backed login is unavailable
because the Agent process receives no host credential-store authority.

Native Codex's API-key path is Responses-compatible only; selecting
`chat-completions` fails closed. Claude Code uses its Anthropic-compatible API
path. `ANTHROPIC_API_KEY` selects API-key authentication;
`ANTHROPIC_AUTH_TOKEN` selects bearer-token authentication, with the API-key
channel explicitly blanked inside the client process. Supplying both nonempty
credentials is ambiguous and fails closed. Pi delegates an API-key selection
to the exact built-in provider named by `PI_PROVIDER`; Jig does not add an
endpoint or provider registry. Pi
subscription support is currently bounded to its `anthropic` and
`openai-codex` providers. No native profile hard-codes a production model.

Jig reads native credentials in trusted host code and gives the contained
client only the bounded credential projection needed for one provider
lifetime. Credential sources are not mounted. The selected non-secret client,
API, endpoint, model, and exact executable/support identities enter provider
identity and the reviewed Plan; secrets do not. Changing non-secret behavior
requires another `jig review` and approval, while rotating only the selected
credential does not.

The Flow remains in its ordinary network-isolated, keyless sandbox. Native ACP
clients run in separate bounded scopes with inherited
network access. Each native client starts in an empty work directory. The finite ACP
peer advertises no filesystem, terminal, or MCP client capability, supplies no
MCP servers, and denies permission requests. Claude and Pi additionally disable
native tools and ambient extensions/skills through their fixed profiles. Codex
retains its constrained native tool environment: its read-only ACP mode selects
a no-network workspace policy, managed requirements forbid full-access mode,
and the projected subscription credential file is denied to its tools. The
editable Flow cannot change those profiles or request additional authority. Selected
FLOW skills are rendered into the call instructions as bounded read-only text;
they are not exposed as a client filesystem or native skill installation.

Native workers have ordinary inherited network access rather than
endpoint-filtered egress; their exact trusted bytes and configuration, not a
network-policy framework, limit what they do. The ordinary API method instead
uses the exact [HTTP Request](http-request.md) resource. Its API requests ask
for `store: false`; this is not a promise about an endpoint's retention or
training policy.

If the selected client, executable support, credential, or model is missing or
invalid, reviewing a native-grant target reports it unavailable. A known setup
failure uses `PROJECT_ACP_<CLIENT>_<STAGE>`, with client `CODEX`,
`CLAUDE` or `PI`. Stages distinguish `EXECUTABLE` discovery, `INSTALLATION`
support, Codex `SANDBOX` support, `LOGIN` subscription authentication, `API`
configuration and missing `MODEL` selection. The CLI gives client-specific
corrections without publishing raw exceptions or secret values. Unclassified
failures remain `PROJECT_ACP_UNAVAILABLE`; the host does not guess their cause.
A target without native requirements in an already admitted generation remains runnable
because its recipe does not depend on the Agent implementation.

`jig review` authenticates and admits the selected local configuration. It does
not send a remote health-check request, so `ready` does not assert that a model
endpoint is currently reachable or accepting requests.

Root `jig run --timeout DURATION` bounds the complete sequence, including the
Agent call and any selected child. The default is 30 seconds and the maximum
is 24 hours; neither an API worker, native client, nor child can extend the
root's absolute deadline. Cancellation fences Jig's complete local Agent
scope, though it cannot retract a remote request already accepted.
