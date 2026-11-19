# UC-004 Place validation before a file is written

> “Reject duplicate contact addresses before writing a preview. That applies to audit imports, standard imports, and previews requested directly.”

**Actor and goal.** A coding agent needs to find where validation can protect every route to the first write.

## Starting situation

Consider two import Bindings that both call an exporter. The exporter can also run on its own.
In Contact Import, the exporter writes the file before returning. The importer then checks the returned metadata and forwards the artifact.
A check in the importer after export would leave the write reachable.

## Main scenario

1. The agent locates the first write and follows its incoming calls back to both import Bindings.
2. It follows a direct request to the exporter. That path enters below any check in the importer.
3. It identifies where the addresses are available for validation on all three paths. It traces a refusal to its exit and an accepted preview to the write.

## Alternatives and success

If a Binding selects a different exporter, the agent follows that selection to its own write.
Before editing, it can name the validation site or sites that cover all three entrypoints and the successful paths that still deliver a preview.
If a target is chosen dynamically, it can point to the selection that needs inspection.

## Related specification and evidence

[JOB-001](JOB-001-locate-a-workflow-edit.md) · [FEAT-001 Flow inspection](JOB-001-locate-a-workflow-edit.md#feat-001-flow-inspection)

The [importer](../../examples/contact-import/flows/import/method.ts) and [exporter](../../examples/contact-import/flows/export-preview/method.ts) show the order of the write, return, and metadata check.
The scenario `a guard before a child write labels the incoming edge and later guards stay after the write` checks this ordering. [Inspection scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L1746)
The scenario `the independent exporter writes the complete preview without overwriting files` exercises the direct path. [Contact Import scenario](../../examples/contact-import/test/import.test.ts#L162)
