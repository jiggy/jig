# UC-001 Redirect one conditional route

> “When we can’t map the contact columns, send the import to mapping review. Keep exporting ready previews.”

**Actor and goal.** A coding agent must find who chooses the next step after conversion. The workflow owner wants to redirect just one result.

## Starting situation

In Contact Import, the converter can return `done` with either `ready` or `needs_mapping` in its output.
The importer accepts `done` and calls the exporter. The exporter writes the preview. Mapping review is the requested destination.

| Conversion result | Current next step | Requested next step |
| --- | --- | --- |
| Columns need mapping | Export preview | Send to mapping review |
| Columns are ready | Export preview | Export preview |

## Main scenario

1. The agent finds where conversion returns the status that distinguishes the two cases.
2. It follows the result back to the importer's outcome check and locates the call through the exporter slot.
3. It identifies the importer as the owner of the new branch and traces the ready branch through the same exporter.

## Alternatives and success

The importer also handles a mapper's `blocked` or `limit` before it calls the converter. The selected mapper determines whether either result can occur.
If mapping review needs a new slot, the agent identifies the new connection separately from the existing branch.
Before editing, it can point to the importer check and explain why the ready and mapper-refusal paths stay separate.

## Related specification and evidence

[JOB-001](JOB-001-locate-a-workflow-edit.md) · [FEAT-001 Flow inspection](JOB-001-locate-a-workflow-edit.md#feat-001-flow-inspection)

The current route crosses the [converter](../../examples/contact-import/flows/convert/method.ts), [importer](../../examples/contact-import/flows/import/method.ts), and [exporter](../../examples/contact-import/flows/export-preview/method.ts).
The portable scenario `a callee-only change alters the unchanged caller continuation` checks how a returned status can select or skip export. [Executable scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L158)
