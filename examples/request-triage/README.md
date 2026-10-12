# One caller. Code, Agent, or both.

Suggest a support queue for a supplied request. Three Bindings configure the
same intake Flow with different classifiers. The caller always invokes its
`classifier` slot and receives the same input/result contract.

| Binding | Implementation | Unlabeled request |
| --- | --- | --- |
| `intake` | Recognize `[billing]` or `[technical]` prefixes | Suggest `manual` |
| `agent` | Ask one operator-selected Agent | Interpret the message |
| `mixed` | Recognize prefixes, then ask an Agent when absent | Interpret the message |

With Jig installed on a [supported host](https://jig.md/guide/), run from this
directory. Configure and authenticate the client selected in `bindings/model.ts`
through [Choose an Agent](https://jig.md/guide/agents); the included inline policy
selects Claude Code as an example. The default code classifier calls no Agent,
but review also checks this project's selected Agent and mixed alternatives.
An unavailable selected client stops project review before new approval.

```sh
jig review --allow-resolution-network
jig run
```

Review prepares the ordinary declared dependencies. Inspect and approve its exact
proposal. The entrypoint selects `fixtures/labeled.json` and a one-minute deadline.
This result-only Flow returns its queue suggestion on stdout; no packet directory
is created by default. Add `--json` for the complete machine record, or use
`jig run --out ./triage-result` to save `result.json` in a retained location.
That directory must not already exist; Jig never overwrites an earlier result.

The shared project route supplies that Agent to both intelligent classifiers.
To propose a different installed client for this review, use
`jig review --agent CLIENT --allow-resolution-network`, where `CLIENT` is
`codex`, `claude`, or `pi`. Review shows the effective client before approval;
it leaves the Binding unchanged. Repeat `--agent CLIENT` on later reviews, or
edit the Binding for a lasting choice. Without the argument, later review
proposes the source client again. Normal `jig run` uses the approved client and
code; failed review keeps the previous approval.

```sh
jig run binding:agent --input @fixtures/labeled.json --timeout 2m
jig run binding:mixed --input @fixtures/labeled.json --timeout 2m
```

Inspect and approve the review before running. All three use the same caller
source. To change the method behind a Binding, edit its `classifier` target and
review again. Interface consistency does not approve changed execution bytes.

The code and mixed variants return `{"queue":"billing"}` for the labeled
fixture. The Agent is asked to suggest the same queue but can choose differently.
Try `fixtures/unlabeled.json`: code suggests `manual`; Agent and mixed interpret
it. Their result shapes match even when their judgments do not.

`done` returns a suggestion, including `manual` when appropriate. `blocked` and
`limit` return a reason. Execution errors propagate without automatic retry.
The example sends no messages, issues no refunds, and performs no queue writes.
Its labels and Agent suggestions are untrusted input to any consequential policy.

## Follow the work

The **Request** view shows the supplied message, the selected procedure and the
suggested queue. Each classifier offers the same view when called independently.
**Execution** follows the actual classifier and Agent calls; `manual` remains a valid
suggestion, with no business action dispatched.

Add `--display tui` for a terminal workspace or `--display web` for the same
views in a browser. Open the private link printed after execution starts. The completed inspector
stays open until you explicitly close it; leaving a live display does not cancel work.
Blocking causes remain reachable from every view. Plain output and `--json` remain
available.

Read the [complete walkthrough](../../docs/jig/guide/request-triage.md) for the
caller, contract, review boundary, and where application checks belong.

From the repository root:

```sh
bun test examples/request-triage/test
```

These deterministic tests use Agent substitutes. They check call counts,
result handling, direct branches, and failure propagation, not model quality.
