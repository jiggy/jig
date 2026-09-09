---
name: repair-progress-monitor
description: Filter and format selected repair phases without receiving source, Agent authority, or patch verdicts.
channels:
  phases:
    direction: receive
    schema:
      type: object
      properties:
        phase:
          type: string
          enum: [baseline, proposal, check, finished]
        attempt:
          type: integer
          minimum: 0
          maximum: 2
      required: [phase, attempt]
      additionalProperties: false
  display:
    direction: send
    delivery: direct
    schema:
      type: string
      maxLength: 256
outcomes:
  blocked: Progress was incomplete; the repair result remains independent.
---

The direct or broadcast `phases` input carries bounded application records: `baseline` precedes
the original checks, `proposal` precedes an Agent request, `check` precedes
candidate checks, and `finished` means the method is returning a result, not
that its patch passed. `attempt` is zero for baseline and one or two for
proposal/check; finished carries the number of recorded attempts.

Format selected records onto `display`. Settings accept `style: descriptive`
(default) or `compact`, and an optional `phases` list; an empty list suppresses
all progress. No source, issue, Agent messages, command output, credentials,
or acceptance evidence reaches this Flow. It has no capabilities or children.

Reading or sending may fail independently of repair. Dispose the receiver,
report incomplete progress, and leave the repair execution result to the caller.
The caller may substitute another monitor through its exact slot without
changing the repair method.
