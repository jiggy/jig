# Child Checkpoint

*Status: prerelease Jig native invocation contract.*

Read the latest accepted checkpoint of a settled child call while its parent Flow remains active.
A router can inspect retained work and pass selected material to another reviewed method.
The original child result and the application's acceptance decision remain separate.

## Declare and call

Copy the [descriptor](https://jig.md/contracts/child-checkpoint/contract.json) into the calling Flow package.
Declare a local slot in `FLOW.meta.json` or optional Markdown frontmatter:

```json
{"uses":{"recovery":{"contract":"./contracts/child-checkpoint/contract.json"}}}
```

After the Flow's child call with operation ID `draft` settles, read its checkpoint:

```ts
const recovered = await run.call({
  operationId: 'recover:draft',
  slot: 'recovery',
  input: { operationId: 'draft' },
})
```

The outer operation ID identifies this retrieval operation.
The input ID identifies the original direct child call in the caller's own operation namespace.
Both use ordinary Run/0 operation identity rules.
Input contains exactly `operationId`, a valid Run/0 ID of at most 128 characters.

The contract ID is `https://jig.md/contracts/child-checkpoint`, version `0.1.0`, with canonical descriptor digest
`sha256:efc27e2d4ec6a16656d25ec0493c5d981a3e47a30c334e380a65c920d3e531fc`.
Jig resolves this exact native interface without a resource grant.
The selected child and any replacement target still require ordinary reviewed routes.

## Result and artifact

A known settled child with no accepted save returns:

```json
{"outcome":"done","output":{"checkpoint":null}}
```

An accepted save returns these ordinary result fields:

```json
{
  "outcome": "done",
  "output": {
    "checkpoint": {
      "sequence": 1,
      "digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "evidence": {"completed": ["outline"], "accepted": false},
      "files": {"outline.txt": "A retained outline."}
    }
  }
}
```

The host also supplies `artifacts.checkpoint`, a fresh reference held by the caller.
Its immutable tree contains all saved text and associated trees beneath `artifacts/<association>/`.
The `files` field contains only the saved text map.
The result exposes no producer artifact reference, private owner identity, or checkpoint scope identifier.

The caller can use ordinary artifact reading, forwarding, attachment routing, and release operations.
It can associate this held artifact with its own [Run Checkpoint](run-checkpoint.md) save.
Successful retrieval grants this artifact independently of the original child's outcome.
A failed child call still grants no artifacts through its failure result.

## Scope and settlement

Only the immediate caller can retrieve the checkpoint of its direct child.
The input cannot select another Run, a sibling, a grandchild, or a native operation.
The host binds accepted saves to the root Run and full authenticated invocation ancestry.
Sibling calls and repeated invocations keep separate sequences and retained aggregates.

The child must have a terminal result and confirmed closure of its owned execution tree.
Success, failure, or confirmed child cancellation can leave an accepted checkpoint.
An active child is unavailable, even if it has already saved work.
Root or ancestor cancellation closes the caller's authority. Retrieval cannot keep the tree alive.

A lost save acknowledgement may still leave accepted work.
Retrieval reads the owner's committed record after settlement, independently of that acknowledgement.
It never resubmits the child, continues its program, or decides that an uncertain external effect is safe to repeat.

The parent decides whether the evidence proves useful work for its application.
Repair and replacement use the parent's reviewed targets, explicit inputs, and held artifact routes.
A later candidate requires its own acceptance decision.

## Bounds and failures

The [Run Checkpoint limits](run-checkpoint.md#bounds-and-identity) govern every saved aggregate.
All scopes share the original root attempt's retained artifact allowance and retirement policy.
Retrieval also consumes the caller's ordinary live artifact and Run/0 operation budgets.
The complete result must fit JSON/0 depth, node, and byte limits before artifact custody is issued.

| Condition | Result |
| --- | --- |
| Known settled child without an accepted checkpoint | `done` with `checkpoint: null` and no artifact |
| Known settled child with a readable accepted checkpoint | `done` with checkpoint data and `artifacts.checkpoint` |
| Malformed input or operation ID | `INVALID_INPUT` |
| Unknown, active, foreign, or native operation | `UNAVAILABLE` |
| Accepted bytes cannot be verified or read | `UNAVAILABLE` |
| Result, retention, or live artifact budget is exhausted | `RESOURCE_EXHAUSTED` |

Retrieval never changes the original child terminal.
An unavailable checkpoint does not prove that the child performed no work.
The ordinary cancellation and owner-closure failures still apply.

## Application recovery after the root ends

Contained Flow retrieval ends with the root's execution authority.
The original application ticket can still inspect the retained scope inventory and export a selected checkpoint after confirmed cleanup.
Its separate `checkpointInventory` status distinguishes verified discovery from expired or unavailable metadata.
An unavailable inventory does not erase a known execution result or imply that no checkpoint was accepted.
This uses [execution client](execution-client.md) retention and export rules.

It creates no independent child Run and does not extend the original attempt's retention.
Automatic root packet delivery continues to select only the root checkpoint.
