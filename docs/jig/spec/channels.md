# Jig channels

*Status: experimental direct and isolated-broadcast implementation.*

Channels carry data without granting execution or control authority. FLOW owns
the [portable contract](https://flow.jig.md/spec/run-protocol); Jig owns exact
connection admission, finite storage and cleanup. Applications choose what to
publish and how to display it.

## Supported connections

A Flow can create direct or broadcast channels. Either delivery can connect a
send endpoint to the optional `events` channel of an [Agent Run](agent-run.md).
The native ACP adapters
implement the exact [ACP public updates](../contracts/acp-public-updates.md)
profile. API clients retain ordinary one-shot support; requesting this profile
from an unsupported client fails before provider dispatch.
An Agent can publish once to independently bounded subscribers; applications
need no relay merely to fan out the same named updates.

Existing exact child calls also accept channel maps. A root may hand a sender
to one child and its receiver to another, or keep one end itself. Each child
receives only its declared, admitted endpoints in `run.channels`; an unused
incoming endpoint can be forwarded to a compatible capability method. No new
call method, attachment authority or target-discovery right is introduced.
The existing two-sibling limit remains: a worker and a monitor occupy both
branches. A child cannot invoke further child Flows.

`jig run TARGET --receive NAME` connects a declared root send channel to the
command's output. Repeat the flag for distinct outputs, up to 16. Required root
channels must be connected before execution; optional unwired channels are
absent. Unknown, receive-direction or unsupported selections reject before the
Flow process starts. A selected broadcast output receives a command-owned
subscription before dispatch, starting at sequence one; an unspecified delivery
uses direct. Root receive channels and connections between independent root
Runs are not supported.

`run.channel({ delivery: 'broadcast' })` returns a sender and creator-only
`subscribe()` authority. Each subscription allocates an independent receiver.
Pass unused receivers to exact child calls or consume them locally; transferring
the sender does not transfer subscription authority. Late subscriptions start
at the next accepted source sequence and require a `suffix`-accepting port when
mapped after sequence one. There is no replay, reconnect, or registry of sources.

Local channel creation needs no capability declaration. Endpoint operations use
separate bounded protocol capacity, not an Agent/command worker reservation.
They do not increase concurrent execution authority.

## Admission and lifetime

Contracts resolve only from the admitted package, including references in
capability-method declarations. No URL fetch, inferred compatibility or adapter
conversion occurs. Jig checks local names, direction, exact named meaning,
schema agreement, delivery and start position before atomically moving rights.
Failed admission moves nothing. The sender of a call loses its offered rights
only when the host commits transfer; merely offering them does not connect a
producer. A rejected call may therefore leave a receiver waiting with no
producer, and the caller must dispose it when abandoning that observation.
An endpoint used locally cannot move; an unused received endpoint can move
onward, but its former holder cannot use or transfer it. Possession is scoped
to the exact participant, not merely knowledge of a token.

Receiver disposal alone does not invalidate an unused sender's ownership. That
sender can still move while its source owner lives and the source is neither
failed nor sealed; all mapping checks still apply. Its subsequent send or close
fails `DISCONNECTED` for direct delivery. Broadcast retains other subscriptions
and accepts new ones while open. This neither reconnects the disposed receiver nor promises delivery:
an early-exiting monitor must not prevent an otherwise admitted worker merely
by winning the connection race. Disposed receivers cannot move.

A successful send means source acceptance, not processing or durable delivery.
Receiver disposal stops observation, not the Agent. Direct sends backpressure
against finite capacity. Broadcast acceptance never waits for a subscriber:
overflow fails only that reader with `LAGGED`; incompatible future data fails
only the affected reader. Writer/source validation failure aborts the source.
With no subscribers, accepted values consume sequence and source byte budget
without being retained. EOF closes one data interval; the caller must separately
await the execution result. Normal caught failures need no acknowledgement API.
Stopping or failing a monitor does not cancel its worker. A failed child whose
owned work is conclusively fenced and cleaned returns a recoverable call error;
it does not automatically fail healthy siblings. Root cancellation and failed
cleanup still prevent success.

Completion checks owned unfinished work before implicit writer sealing. A
failed producer aborts unsealed output. Explicitly sealed output may drain after
its writer fails, while its source owner remains alive. Ending the source owner's
lifetime also ends buffered delivery. Active unfinished receivers prevent success;
cleanup cannot retrospectively turn their abandonment into ordinary completion.
A newly allocated broadcast subscription is active even before its first read.
Cancelled allocation waits retain late grants and their cleanup settlement.

## Fixed root bounds

| Resource | Bound |
| --- | --- |
| Sources / receivers allocated over the Run | 16 / 16 |
| One encoded value | 64 KiB |
| Accepted bytes per source | 8 MiB |
| Receiver buffer, including committed unread response | 16 items / 256 KiB |
| Pending sends across the root | 16 / 256 KiB |
| Resolved package-local channel descriptors | 16, each at most 256 KiB |

Existing Run/1 wire limits remain 64 live and 65,536 lifetime requests, with
settlement capacity reserved inside those bounds. They are not new per-local-
attempt quotas. Contract compilation retains Schema/1 limits.

The native ACP reader never waits for subscriber capacity. A separate ingress
retains at most 16 items / 256 KiB, including its pending send. Overflow fails
the update channel with `LAGGED`; the adapter continues draining ACP and
settling the actual Agent result. Invalid projected values fail the channel,
not an otherwise valid Agent result. No raw ACP stream is echoed privately.

## Installed subprocess output

With `--receive`, stdout is newline-delimited JSON/1, with these records:

| `type` | Fields |
| --- | --- |
| `begin` | `channel`, `startSequence` |
| `data` | `channel`, `sequence`, `value` |
| `end` | `channel`, `status: "closed"`, `lastSequence`; or `status: "failed"`, `code` |
| `terminal` | `result`: the ordinary Jig Run terminal, including optional file-delivery evidence |

Records are ordered within each selected channel. Every begun channel ends
before the terminal when output remains connected; concurrent channels may
interleave. A rejected selection produces only a failed terminal. The terminal
alone establishes execution status. A missing terminal or incomplete final line
means incomplete delivery, not success or permission to retry.

Without `--receive`, stdout remains the ordinary single terminal JSON value.
Flow console diagnostics stream to stderr in both modes, independently of
channel records; terminal control characters are escaped and the existing Run
diagnostic bounds still apply. Diagnostics are neither channel values nor evidence
of successful work. For each output stream, the installed writer bounds queued
output to 256 pending writes / 20 MiB and each write to one second. Blockage or
disconnection requests root cancellation;
independent containment still owns fencing. No final record is guaranteed after
output loss, interruption or coordinator loss. There is no replay or durability
promise for channels.
