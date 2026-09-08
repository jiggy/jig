# Jig channels

*Status: experimental direct-channel implementation.*

Channels carry data without granting execution or control authority. FLOW owns
the [portable contract](https://flow.jig.md/spec/run-protocol); Jig owns exact
connection admission, finite storage and cleanup. Applications choose what to
publish and how to display it.

## Supported connections

A root Flow can create direct channels and pass unused send endpoints to the
optional `events` channel of an [Agent Run](agent-run.md). The native ACP adapters
implement the exact [ACP public updates](../contracts/acp-public-updates.md)
profile. API clients retain ordinary one-shot support; requesting this profile
from an unsupported client fails before provider dispatch.

`jig run TARGET --receive NAME` connects a declared root send channel to the
command's output. Repeat the flag for distinct outputs, up to 16. Required root
channels must be connected before execution; optional unwired channels are
absent. Unknown, receive-direction or unsupported selections reject before the
Flow process starts. Root receive channels, child channel transfer, broadcast,
subscriptions and cross-Run connections are not supported in this slice.

Local channel creation needs no capability declaration. Endpoint operations use
separate bounded protocol capacity, not an Agent/command worker reservation.
They do not increase concurrent execution authority.

## Admission and lifetime

Contracts resolve only from the admitted package, including references in
capability-method declarations. No URL fetch, inferred compatibility or adapter
conversion occurs. Jig checks local names, direction, exact named meaning,
schema agreement, delivery and start position before atomically moving rights.
Failed admission moves nothing. A used or already moved endpoint cannot be
transferred again. Possession is scoped to the exact participant, not merely
knowledge of a token.

A successful send means source acceptance, not processing or durable delivery.
Receiver disposal stops observation, not the Agent. Direct sends backpressure
against finite capacity. EOF closes one data interval; the caller must separately
await the execution result. Normal caught failures need no acknowledgement API.

Completion checks owned unfinished work before implicit writer sealing. A
failed producer aborts unsealed output. Explicitly sealed output may drain after
its writer fails, while its source owner remains alive. Ending the source owner's
lifetime also ends buffered delivery. Active unfinished receivers prevent success;
cleanup cannot retrospectively turn their abandonment into ordinary completion.

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
