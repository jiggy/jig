---
title: Validate inputs and results
description: Add a local contract that checks the classifier's input and complete outcome/output result.
---

# Validate inputs and results

Use schemas when callers need a checked shape for the values crossing a method boundary.
A local `FLOW.contract.json` can validate input and the complete result without a named interoperability agreement.
Keep checks of classification quality in the application.

This guide extends the [classifier's outcome example](outcomes.md).
It accepts a message string and returns a queue with either `done` or `needs-review`.
The allowed queue names belong to this illustrative method.

## Describe the boundary

Replace `flows/classify-request/FLOW.contract.json` with:

```json
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-0.schema.json",
  "outcomes": {
    "needs-review": "A person must choose the request's queue."
  },
  "input": {
    "type": "object",
    "properties": { "message": { "type": "string" } },
    "required": ["message"],
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "outcome": { "enum": ["done", "needs-review"] },
      "output": {
        "type": "object",
        "properties": {
          "queue": { "enum": ["billing", "technical", "manual"] }
        },
        "required": ["queue"],
        "additionalProperties": false
      }
    },
    "required": ["outcome", "output"],
    "additionalProperties": false
  }
}
```

`input` validates the supplied value.
`result` validates the complete `{outcome, output}` object, rather than `output` alone.
This schema checks the accepted strings and object shapes.
Application checks establish whether a queue suggestion fits the request.

## Check valid and invalid values

Review the descriptor and run the method:

```sh
jig review --allow-resolution-network
jig run flow:flows/classify-request --input '{"message":"I was charged twice."}' --json
```

The completed method returns:

```json
{"outcome":"done","output":{"queue":"billing"}}
```

Run the same command with `{"message":12}`.
The input should fail validation before the method performs domain work.
An extra input field also fails because this example rejects additional properties.

Temporarily change the handler's returned queue to `"finance"`.
Review the changed source and repeat the valid request.
The result should fail validation instead of publishing a valid classification.
Restore the original queue values when the check is complete.

## Choose the precision your callers need

Add named contracts when independently maintained consumers need an exact shared interface.
The [contract explanation](https://flow.jig.md/understand/contracts.md) distinguishes local validation from exact named matching.
Procedure size or Agent involvement alone does not require a named contract.

`settings.schema.json` validates implementation settings separately.
It leaves invocation input and result declarations in `FLOW.contract.json`.
Use [Schema/0](../spec/schema-files.md) for the supported dialect and exact validation points.

The same descriptor structure applies to a Markdown implementation.
Keep that implementation's readable metadata in `FLOW.md` frontmatter.
[Package/0](../spec/package-format.md) defines the metadata owner for each format.
