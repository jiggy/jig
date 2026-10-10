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
directory. The default code classifier needs no Agent:

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

For the Agent and mixed routes, follow [Choose an Agent](https://jig.md/guide/agents)
and configure `grants/agent.json`, which selects Claude Code as an example choice.
Interactive review can offer a separately confirmed client correction when its
executable is missing; manual edits require renewed review. The shared project
route supplies that Agent to both intelligent classifiers. Missing Agent support
leaves the code route usable; the other routes require a fresh ready review.

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
