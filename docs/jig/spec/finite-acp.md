# Finite ACP resource

**Status:** experimental alpha candidate. Native restoration requires matching
source artifacts and separate installed-client qualification; this specification
does not establish registry availability or successful live restoration.

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

An optional grant `model` selects the model for this recipient, overriding the
matching operator model variable without changing authentication mode, endpoint,
provider or executable. It is 1–256 ASCII characters: an initial letter or digit,
then letters, digits or `._:/+-`. Omission retains the selected client's operator
configuration and documented default. Two Bindings can use the same client with
different models. Changing this policy requires renewed authority approval;
the ready configuration and native dispatch enforce the selected model.

Input is normally `null`. A requested native session uses the closed shape
`{session:{retain:true}}`, `{session:{retain:true,lifetime:"run"}}`, or
`{session:{restore:reference}}`, where `reference`
is an opaque, canonical lowercase 36-character UUID from a previous final
resource result. Either request requires
the separately reviewed grant `retainSessions:true`; omission of that grant
permits only ephemeral calls. `restore` also requests a successor snapshot after
the new invocation settles. See [retained native state](#retained-native-state).

Both channels are required and direct: the resource receives
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
  "maxTurns": 1,
  "configuration": [{ "configId": "model", "value": "reviewed-model" }],
  "modeId": "read-only"
}
```

`maxTurns` is the reviewed grant's prompt allowance (1–8; omitted grant policy
means 1). It is included in ready for the method to explain limits; only host
policy grants dispatch. Changing the allowance requires renewed approval.
`configuration` is an ordered array, possibly empty. String settings use
`{configId,value}`; Boolean settings use `{configId,type:"boolean",value}`.
Configuration IDs are unique; at most 16 are supplied. Identifiers and string
values are nonempty Unicode scalar text, contain no NUL, and are at most 1,024
UTF-8 bytes. `modeId` is optional. For an authorized restoration, ready also
contains `restoreSessionId`, the host-owned native ACP session identifier from
the claimed snapshot. It is private transport metadata, distinct from the
public opaque reference; the Agent method must not copy it into public output.
It is absent for a new session. The complete ready item must fit 64 KiB.
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
| Complete frames | 64 | 8,192 |
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
2. One `session/new` at `/work`, with an empty `mcpServers` array and no `_meta`,
   or, when ready contains `restoreSessionId`, exactly one `session/resume` with
   `{sessionId:restoreSessionId,cwd:"/work",mcpServers:[]}`. Restoration requires
   initialization to advertise `agentCapabilities.sessionCapabilities.resume`;
   no `session/new` fallback is permitted.
3. Each exact ready configuration transition, in order, with confirmation of
   its reviewed value; then the exact mode transition if present.
4. Up to the grant's `maxTurns` serial `session/prompt` requests on the owned
   session, each containing one text block, at most 1 MiB. The preceding prompt
   must settle before another dispatch. NUL and leading slash commands are excluded.
5. Optional `session/close` if the initialized client advertised it.

After each prompt is dispatched, at most one `session/cancel` notification may
name that owned session. It cannot settle pending work by itself. A cancellation
that races completed settlement is consumed without forwarding to the idle
client. An active interruption must settle within five seconds; otherwise the
host fences the resource and reports unsuccessful/uncertain execution. New
session IDs come from the correlated `session/new` response, never from a
notification. A restored session uses only the already-claimed identifier in
ready; its correlated resume result is projected as exactly `{}`. Current
reviewed configuration and mode must be reapplied before the first prompt.
Excess prompts, overlapping prompts, extra sessions, provider selection, authentication, tools, filesystem
requests, unreviewed mode changes, unclaimed session replacement and metadata are rejected. Native
permission requests receive the host's fixed cancelled answer, not a choice
made by the editable adapter.

Native text and plan updates outside an active prompt fail rather than contaminating
a subsequent answer. Aggregate frame, byte, update and text ceilings never reset
between turns. Only correlated results, a constant sanitized request error, public assistant
text, public plan updates and closed warning notices reach the adapter. Unneeded native fields are
withheld. One conversation permits at most 4,096 updates, 8 MiB of assistant
text and 256 permission requests; raw native protocol ingress remains bounded
at 32 MiB before projection. The host accounts for ignored frames too.

The host negotiates the supported typed native diagnostic extension independently
of Flow input. Warnings are projected as `session/update` with
`update:{sessionUpdate:"session_info_update",_meta:{notice:{code:"NATIVE_WARNING"}}}`.
They carry no raw native title, action, path or credential. Notices preceding the
owned session response are coalesced and delivered after that response; they
never establish session identity. Warnings may also arrive between turns or
after the final answer. The ordinary Agent reports a fixed console diagnostic,
not answer text or a public Agent event. An authoritative native error on either
a notification or result fails the resource, including during startup and after
prompt settlement; negotiating typed diagnostics must not hide native failure.

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

After possible dispatch, a recognized native session failure or finite-protocol
rejection retains a closed explanation alongside `UNCERTAIN`. The host never
copies an exception message or native diagnostic into that explanation.
Unclassified failures remain unspecified; a warning alone establishes no cause.
Cancellation, deadline and cleanup failure keep their existing precedence.
An explanation neither proves whether remote work occurred nor permits retry.

Response framing must finish and its writer must close before the resource
returns. Essential channel failure cancels/fences the resource and waits for
owned work to settle. No uncertain operation is retried. Process settlement,
ACP stop reason and the application-checked Agent answer remain distinct.
The host does not reconstruct an Agent answer in this resource result.

If input requested a session, the successful final resource `output` also
contains exactly one receipt: `session:{status:"retained",reference:uuid}` or
`session:{status:"unavailable",reason}`. Otherwise it omits `session`. Receipt meaning
is independent of the Agent's answer and requires the additional evidence below.

## Retained native state

Retention crosses a lifetime and authority boundary, so the host owns its
collection, protected storage and restoration. The ordinary Agent Flow passes
the explicit request and final receipt without reading native files or supplying
storage paths. `retainSessions:true` is separate reviewed authority from model,
credentials and `maxTurns`; possession of a reference cannot replace it.

The initial collection profile accepts Codex 0.154.0 with exactly one owned
rollout JSONL file. Its records must identify the owned session, be complete,
contain the required final turn completion, fit the bound and exclude credential
content. Unrecognized versions, extra or unowned rollout files, invalid paths,
incomplete records and oversized or credential-bearing state are unavailable.
The profile copies no home directory, SQLite database, authentication, tools,
forks, partial turns or compaction state. These restrictions do not grant the
native client additional tools or workspace access.

The host returns `retained` only after the final native turn has settled, an
actual clean native exit has been observed, the complete owned scope has been
fenced, bounded collection has passed profile validation, execution resources
have been cleaned up and the protected snapshot has committed atomically.
Controlled or forced closure cannot yield a reference, even if a termination
handler exits zero. A clean protocol close that needs controlled termination
may still produce the ordinary successful resource result with
`session:{status:"unavailable",reason:"not-cleanly-closed"}`. Retention failure does not invalidate a
separately valid Agent answer, but it never hides a resource execution or cleanup
failure that already requires an invocation error.

Before consuming a reference, the host checks current authorization against
the protected project identity, root target and request digest, ordered
target/request-digest ancestry, immediate native slot and exact provider/profile
digest. Operation identifiers and ordinary prompt input do not bind restoration.
Run-scoped state additionally requires the original root Run identity and its
active authority; ordinary retained state may cross Runs. Aliases selecting
the same admitted target are equivalent; this
profile does not promise isolation by incoming slot alias. Accepted code or
configuration changes that alter these identities require a new conversation.

A reference is claimed atomically once before native startup, with restored
bytes placed in a fresh private scope. Concurrent claims cannot create two
owners. A claim is consumed even if subsequent startup, resume or execution
fails. Unsupported, expired, foreign and reused references fail visibly. The
host does not silently create a session, replay a transcript, retry uncertain
work or restore authentication. Current grants and current credentials are
revalidated independently of retained content.

The protected project store permits at most 16 available snapshots, each at
most 8 MiB. Available snapshots expire logically after 24 hours and are pruned
on the next store access; this is not an automatic secure-erasure promise.
`lifetime:"run"` additionally binds retained state to the current root. Its
successor inherits that restriction with no option to widen it. The reference
survives individual Agent calls but cannot be claimed from another root, even
with an otherwise matching recipient. Root settlement deletes its temporary
snapshots in the same transaction that publishes its terminal; deletion failure
prevents that terminal commit. Recovery uses the same cleanup path. Interrupted
or uncertain cleanup must not be described as successful erasure. Persistent
cross-Run snapshots are untouched by this cleanup.
Consumed payloads are replaced rather than accumulating tombstones, references
are never recycled, and active ownership remains accountable after expiry.
A successor reference is exposed only after the full settlement and commit
sequence above. Exhausted storage or failed validation yields unavailable
retention rather than an invented reference. Corrupt protected state, storage
commit uncertainty or lost coordinator authority fails the operation; it is
not downgraded to optional retention loss. Unexpected collector or I/O errors
also remain invocation failures, rather than being labelled unsupported history.

Unavailable receipts require one closed reason:

| Reason | Meaning |
| --- | --- |
| `not-cleanly-closed` | Native exit did not qualify for retention, including controlled termination. |
| `missing-history` | Clean native exit produced no rollout in its owned output. |
| `unsupported-history` | Collected history failed the bounded qualified-content profile. |
| `capacity` | The protected store already holds sixteen available snapshots. |

These reasons describe this invocation's retention only. Refusal to restore a
reference does not reveal whether it belongs to another recipient, expired or
was consumed. Neither kind of failure authorizes automatic replay.

Protocol and storage tests establish only their tested boundaries. Actual
save, clean exit and restoration across fresh Runs through the installed
Agent/ACP/Jig path require separate native-client qualification.

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
| Codex | `{ kind: 'acp', client: 'codex' }`; optional absolute `CODEX_PATH` | Operator-owned, file-backed `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`), created by `codex login`; optional `CODEX_MODEL`, with omission retaining the client default | `OPENAI_API_KEY` and a grant `model` or `OPENAI_MODEL`; optional `OPENAI_BASE_URL`; `OPENAI_API` must be omitted or `responses` |
| Claude Code | `{ kind: 'acp', client: 'claude' }`; optional absolute `CLAUDE_PATH` | `CLAUDE_CODE_OAUTH_TOKEN`; optional `CLAUDE_MODEL` | Exactly one of `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, plus a grant `model` or `ANTHROPIC_MODEL`; optional `ANTHROPIC_BASE_URL` |
| Pi | `{ kind: 'acp', client: 'pi' }`; optional absolute `PI_PATH` | `PI_PROVIDER` and a grant `model` or `PI_MODEL`; authentication from `PI_CODING_AGENT_DIR/auth.json` or `~/.pi/agent/auth.json` | `PI_PROVIDER`, a grant `model` or `PI_MODEL`, and `PI_API_KEY`, using a provider implemented by Pi |

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
