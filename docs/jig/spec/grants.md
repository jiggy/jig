# Grants: power through ordinary slots

*Status: prerelease implementation candidate.*

A grant describes a resource and its permitted operation. A Binding connects
that policy to a Flow's declared invocation slot. Only explicit admission makes
the connection executable; neither a name nor a file is an authority handle.

## Start inline

```ts
export default defineBinding({
  package: 'flows/report',
  slots: {
    reference: {
      kind: 'http', url: 'https://docs.example.org/reference', method: 'GET',
      bearerEnv: 'DOCUMENT_TOKEN', responseBytes: 65536,
    },
    tests: { kind: 'command', test: ['test/project.test.ts'] },
  },
})
```

Each slot must declare the exact supported contract for its grant kind:
[HTTP Request](http-request.md), [Project Command](project-command.md), or
[Finite ACP](finite-acp.md).
The call selects the slot, not another resource name inside its input.
Flow and Binding selectors remain available in the same `slots` map.

The finite native grant is `native: { kind: 'acp', client: 'codex' }`, with
`claude` and `pi` as the other qualified client choices. It grants one bounded
ACP conversation, not arbitrary process I/O. The operator's captured native
configuration supplies the executable and private authentication; an optional
grant `model` overrides its model selection for this recipient. Review
shows that selected runtime beside the exact recipient. The ordinary Agent
package drives the dialogue and interprets the answer.

Only these three resource kinds are supported. A grant is closed policy data,
not a plugin, executable code, generic permission bag, or credentials object.
Inline authoring validates inert value structure; trusted project linking also
validates exact URLs, embedded schemas, contract compatibility and resource bounds.

## Reuse a named policy when useful

In `jig.ts`, optionally include `grants: discover('./grants')`. Then
`grants/documents.json` can contain:

```json
{
  "kind": "http",
  "url": "https://docs.example.org/reference",
  "method": "GET",
  "bearerEnv": "DOCUMENT_TOKEN",
  "responseBytes": 65536
}
```

A Binding uses `slots: { reference: 'grant:documents' }`. The filename supplies
the reusable name; `reference` remains the consumer-local slot. Named and inline
policies have identical meaning and validation. A grant name cannot be run as
a CLI target.

Discovery selects immediate regular `<LocalName>.json` files, without recursion,
symlinks or globs. Exact member arrays are also supported. A missing discovery
directory is empty; a missing selected grant or exact file is an error. Duplicate
names across roots fail. Capture permits at most 256 policies, 32 KiB per file
and 1 MiB total. Files must be singly linked. Each Binding permits at most eight
slots of each resource kind within its 256-slot bound. Multiple slots do not
increase concurrent effect capacity, root reservations or deadlines.

## Review and admission

`jig review` shows changes to recipients and effective policies, including
destinations, credential references and limits. Confirming that exact plan
admits the complete project revision atomically. No Flow runs during admission.

Noninteractive `--yes` alone cannot admit new or changed resource delegations.
After checking the displayed changes, trusted automation may use
`jig review --yes --allow-authority-changes`. The trusted administration API
likewise requires `allowAuthorityChanges: true` when applying such a plan.

Authority continuity is scoped to this project, Binding, selected package path,
slot, exact required contract and normalized policy. Copying or renaming a
Binding, replacing its package, or changing its policy requires authority approval.
Any policy change is treated conservatively; Jig does not infer schema
subsumption. Merely renaming a shared declaration with identical effective
policy does not change its permissions. Source revisions at the same recipient
still require exact code admission, but not a second resource opt-in when
permissions are unchanged. Removing a delegation requires normal revision
approval, not approval of additional authority.

Grant files and Bindings are editable proposals. Their contents are captured
under the project's safe source boundary and resolved into the protected
admission generation. Edits, discovery or guessed slot names cannot alter a
running Flow's route table. A Flow has no project-administration access; it can
call only its own admitted routes. Child Bindings use their own policies, not
their parent's, and resource slots do not turn a leaf into a nested Flow graph.

An admitted generation continues to use its captured policy until replaced by
another admission. Source edits are not live revocation. Cancel existing work
to settle its owned effects; already accepted remote effects cannot be undone.
The operator environment supplies secret bytes when the host command starts.
Secrets never enter Binding values, lock files, admission records, Flow input
or public review. Missing selected credentials make that target unavailable;
rotating secret bytes alone does not change public policy identity.

FLOW's interface remains `run.call`: grant storage, approval and enforcement
are Jig responsibilities. This profile does not add arbitrary process grants,
dynamic resource publication, Agent-session replacement, or grant inheritance.
