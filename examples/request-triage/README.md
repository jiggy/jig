# One caller. Code, Agent, or both.

Suggest a support queue for a supplied request. Three Bindings configure the
same intake Flow with different classifiers. The caller always invokes its
`classifier` slot and receives the same input/result contract.

| Binding | Implementation | Unlabeled request |
| --- | --- | --- |
| `intake` | Recognize `[billing]` or `[technical]` prefixes | Suggest `manual` |
| `agent` | Ask one operator-selected Agent | Interpret the message |
| `mixed` | Recognize prefixes, then ask an Agent when absent | Interpret the message |

After [workspace setup](../../docs/jig/guide/dependencies.md#local-workspace-packages),
configure an [Agent](../../docs/jig/guide/agents.md) for the Agent-capable packages
and run from this directory on a [supported host](../../docs/jig/guide/index.md#supported-host):

```sh
jig review
jig run binding:intake --input @fixtures/labeled.json
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

Read the [complete walkthrough](../../docs/jig/guide/request-triage.md) for the
caller, contract, review boundary, and where application checks belong.

From the repository root:

```sh
bun test examples/request-triage/test
```

These deterministic tests use Agent substitutes. They check call counts,
result handling, direct branches, and failure propagation, not model quality.
