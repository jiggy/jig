# Jig Agent Exchange invocation

**Status:** experimental source candidate.

Agent Exchange lets a method send one prepared prompt to an operator-selected
Agent. The method owns instructions and interpretation; Jig owns credentials,
provider dispatch, permissions, resource limits, cancellation and cleanup.
It uses ordinary Run/1 `flow/call` and requires no new FLOW SDK surface.

The canonical descriptor and its complete optional channel closure are
[`agent-exchange/contract.json`](https://jig.md/contracts/agent-exchange/contract.json)
and [`contracts/acp-public-updates.json`](https://jig.md/contracts/agent-exchange/contracts/acp-public-updates.json):

```text
id       https://jig.md/contracts/agent-exchange
version  1.0.0
digest   sha256:060d0a43f18fbcd35da13a416a60ec0ece611d63b6dcf64939024af0bb569cbb
```

Copy the complete bundle into the consuming package, preserving the
descriptor-relative channel path. Declare a local slot in `flow.meta.json`:

```json
{
  "name": "prepared-agent-call",
  "description": "Send a prepared prompt and interpret the returned text.",
  "uses": {
    "exchange": { "contract": "./contracts/agent-exchange/contract.json" }
  }
}
```

Jig matches the exact identity, version and descriptor/closure digest offline.
The identity URL is an explanatory page, never a provider endpoint or a
runtime lookup. Claiming this descriptor cannot turn package code into Jig's
native implementation or grant provider authority.

## Values and limits

The single invocation accepts this closed input:

```ts
{ prompt: string; responseSchema?: JsonObject }
```

`prompt` is nonempty valid UTF-8 text, at most 1 MiB in UTF-8 bytes. A supplied
`responseSchema` is at most 256 KiB in canonical JSON/1 bytes and must satisfy
the current [bounded Agent structured-output profile](agent-run.md#structured-output-profile).
Invalid values or unsupported schemas reject before provider dispatch.
The schema guides the physical request; Exchange does not decode, repair or
validate the returned text as a structured domain answer.

The complete successful invocation result is:

```ts
{
  outcome: "done";
  output: { text: string; stop: "end-turn" | "refusal" | "limit" };
}
```

Both objects are closed. `text` is the bounded final public response;
`end-turn` means the Agent ended its turn, `refusal` means it refused, and
`limit` means it reported a limiting termination, not necessarily output exhaustion. The enclosing `done` establishes
transport completion after required host settlement, not successful domain
work. A reusable method may interpret refusal as `blocked`, or reject malformed
structured output. It cannot turn a host failure into completed work.

The descriptor permits at most 8,388,608 text characters. The provider's byte
bounds and Run/1's 16,777,216-byte encoded frame limit also apply; JSON escaping
and the result envelope consume frame space. No field limit authorizes a larger
frame. Invalid or oversized provider output is an operational failure, not a
fabricated `limit` result. Cancellation, deadline, dispatch uncertainty,
provider failure and cleanup failure likewise remain execution failures.

Each accepted operation performs at most one physical request, with zero
automatic retries. The supplied Agent method calls Exchange once. This is not
a new quota on the number of distinct sequential operations in a Run: existing
Run/1 identity, lifetime and root deadline limits govern those operations.
Possibly dispatched work is never silently repeated. Local cancellation cannot
retract a request already accepted by a remote provider.

## Host authority and composition

Jig uses the [same operator Agent configuration](agent-run.md#alpha-host-implementations)
for Agent Run and Exchange. Input has no provider, endpoint, model, credential,
permission, file, tool, Skill-selection or session-control field. A prepared
request is data and carries no authority beyond its admitted call.

With native ACP clients, Jig rejects a prompt whose `trimStart()` begins with
`/` as `INVALID_INPUT` before allocation or dispatch. The supported clients
interpret such text as control commands, including session compaction, model
selection or authentication changes. This authority safeguard leaves accepted
prompts unchanged; the host adds no method prefix. Direct API clients accept
literal leading-slash prompts.

An exact Exchange requirement qualifies for Jig's native default on a root or
child Flow. A root may call a specialist that calls another Flow, within
[two child levels and the aggregate reservation budget](project-policy.md).
Each child permits one active invocation. A method may instead import the
reusable preparation/result library in-process. Each selected target retains
its own admitted settings and authority; the remaining root deadline applies
throughout the chain.

[Agent Run](agent-run.md) accepts explicit instructions and Skill contents;
Exchange accepts a prepared prompt. Either named interface may be offered by
an ordinary Flow, selected through an exact Binding route with its own grants.
Jig's native default independently validates its provider boundary. A method
consumer owns dynamic result checks and domain interpretation when selecting
an ordinary replacement. Neither interface attests caller-supplied context.

## Optional public updates

`events` is the existing optional send channel with the exact
[ACP public updates](../contracts/acp-public-updates.md) agreement. An unused
incoming endpoint may move directly through the ordinary method to Exchange;
no relay is required. Direct and isolated-broadcast delivery retain their
[existing admission, buffering and lifetime rules](channels.md).

A requested unsupported channel rejects before the lower Exchange transfers
endpoints or dispatches the provider. An outer ordinary Flow may already be
running at that point. Observation failure, EOF and the execution result remain
separate; events grant no continuing conversation or control authority.

## Independent finite hosts

The unchanged ordinary Agent Flow can be consumed by another host that supports
its entrypoint and ordinary Run/1 invocation, resolves this exact package-local
contract closure, and supplies the bounded Exchange values above. Such a host
must preserve JSON/1, schema and frame validation, operation identity, finite
deadlines, cancellation and honest failure. It supplies its own locally
authorized transport and states its actual execution and cleanup guarantees.

Optional events may be omitted. A host accepting an events connection must
implement its exact agreement and channel lifecycle, or reject the request
before dispatch. These obligations do not require Jig's admission store,
containment implementation, configuration variables, SDK or private controller.
An independent host run proves only the public boundaries and workload it
actually exercises; it does not establish Agent answer quality or Jig host conformance.

See [reuse the Agent method](../guide/agent-method.md) for the library and
ordinary Flow artifact, adoption and adaptation.
