# First promotional video: build an app that uses AI like a function

Proposed title: **Build an app that uses AI like a function**.
Concrete subtitle: **A CSV importer built with code, Agents, Jig, and FLOW**.
Target duration: 12–15 minutes. The running project is
[contact-import](../../examples/contact-import/README.md).

## The person watching

A developer has used Agents to build software and now wants intelligence inside
that software. They recognize the chore of mapping someone else's CSV columns.
They understand functions and scripts; they should not need prior knowledge of
FLOW, capability contracts, admission, or microkernel architecture.

The takeaway is: “My application calls a method. That method can use code, an
Agent, or both. I can compose and replace those parts without rewriting the caller.”
The shared interface does not make the implementations equally accurate or fast.

## Opening and payoff

Suggested spoken opening:

> Your app expects three fields. Your customers have thirty different spreadsheets.
> Let's build an importer that understands their headings—and keeps the actual
> conversion in code.

Show `fixtures/unfamiliar/contacts.csv` beside a completed `preview.json`.
Point to the French headings, reordered columns, two accepted contacts, and
Grace's rejected email. Show the proposed mapping too. Explain that the output
is a preview for review; no customer records have been written to a database.

Use a real recorded run, and identify it as the finished example. Do not stage
an output file as if it were the result of the command currently on screen.
“Import anything” can express the feature idea in discussion; do not present
that phrase as a claim that this bounded CSV example accepts every format.

## Rehearsal and recording setup

1. Use a [supported host](../../docs/jig/guide/index.md), complete
   [workspace setup](../../docs/jig/guide/dependencies.md#local-workspace-packages),
   and configure an [Agent](../../docs/jig/guide/agents.md).
2. Open `examples/contact-import`. Keep credentials and personal configuration
   out of the recording. Use only the supplied synthetic data.
3. Rehearse the commands below in a disposable copy. Use fresh output paths
   for each take: the CLI refuses to overwrite an existing destination.
4. Review the actual source and dependency resolution before filming execution:

```sh
jig review --allow-resolution-network
```

The project includes all three mapper configurations; prepare the Agent even
when the first run takes the code-only path. The resolution permission prepares
dependencies, including `csv-parse`, during review; it grants no runtime network
access to the CSV reader. Show the review and approval once, without lingering
on installation mechanics. Review again after any authored source change.

Before filming, run from the repository root:

```sh
bun test examples/contact-import/test
```

Live model output can differ. Rehearse the unfamiliar and ambiguous files with
the chosen provider. Preserve refusals or mistakes as actual results; do not claim
that a selected successful take establishes general model accuracy. A null mapping
or `blocked`/`limit` outcome is a visible result to explain, not silently replace.

## Build sequence and shots

### 0:00–1:00 — Show the result

Use the opening above. Show input, mapping, accepted contacts, and one rejected
record. Promise to explain the small program behind that result.

### 1:00–3:30 — Build the ordinary version

Introduce a Flow as “a method with inputs and a result that another method can
call.” Open `flows/map-code/method.ts`: it recognizes the known headings and
returns indices. Show the `mapping` field and its nullable result in the schema.

Write or explain the central sequence in `flows/import/method.ts`: read CSV,
call `mapper`, call `converter`, write preview. Keep the complete checked source
available; do not type filesystem safeguards from memory while pretending they
are irrelevant. Use prepared code for bounded file reading and CSV parsing, and
say that those parts are already written.

Run:

```sh
jig run binding:code --input '{}' --attach source=fixtures/known --out take-known
```

Open `take-known/files/preview.json`. This path has made zero Agent calls.
Code handles parsing, conversion, and the email rule directly.

### 3:30–5:00 — Encounter unfamiliar input

Open `fixtures/unfamiliar/contacts.csv`. Run:

```sh
jig run binding:code --input '{}' --attach source=fixtures/unfamiliar --out take-unknown
```

Show `needs_mapping`. The exact known-format method does not recognize these
headings. This motivates interpretation without inventing a model failure.

### 5:00–8:00 — Put an Agent behind the same boundary

Build or explain `flows/map-agent/method.ts`. It requests a mapping from headings
only, using the declared Agent capability. It returns column indices, not generated
transformation code. Show its `FLOW.md` capability declaration briefly.

Compare `bindings/code.ts` and `bindings/agent.ts`. Highlight the mapper target;
keep the importer source visible and unchanged. These prepared Bindings are already
reviewed. If editing a Binding live instead, review it before the next run.

```sh
jig run binding:agent --input '{}' --attach source=fixtures/unfamiliar --out take-agent --timeout 2m
```

For the intended interpretation, the mapping is `name: 2`, `email: 1`,
`organization: 0`; Ada and Mei pass, Grace has a row error. Inspect the actual
answer and preview rather than asserting these values before the run finishes.

Suggested line:

> The importer calls a mapping method. It doesn't need a different calling
> convention because this implementation uses an Agent.

### 8:00–10:00 — Combine code and interpretation

Open `flows/map-mixed/method.ts`. Walk through the known-format code followed
by an Agent capability call only for unfamiliar headings. Both live inside one
leaf Flow. Agent `blocked`, `limit`, and execution failure propagate without retry.

```sh
jig run binding:mixed --input '{}' --attach source=fixtures/known --out take-mixed-known
jig run binding:mixed --input '{}' --attach source=fixtures/unfamiliar --out take-mixed-new --timeout 2m
```

Point back to the unchanged importer. The mapper now combines direct code and
Agent interpretation internally. Explain the saved model call for known formats
from the code path; make no numerical latency or cost claim without measuring it.
Current Jig supports a root calling leaves; a child Binding cannot itself have
child slots. Do not draw or promise recursive composition in this demonstration.

### 10:00–12:00 — Check a bad proposal

Open `fixtures/invalid-mapping.json`. Say explicitly: “I'm injecting a bad mapping
to test the converter.” Column 7 does not exist in its three-column input.

```sh
jig run flow:flows/convert --input @fixtures/invalid-mapping.json
```

Show `needs_mapping` and the empty accepted list. Explain the application-owned
check in `flows/convert/method.ts`. This is evidence that this check rejects this
invalid proposal, not a demonstration of universal prompt-injection protection.

Mention that swapping name and organization could still be structurally valid.
The preview exposes the mapping and resulting contacts for review. Software
checks need domain knowledge; Jig cannot make an Agent's interpretation correct.

For an optional live contrast, show the two email columns in the ambiguous fixture:

```sh
jig run binding:agent --input '{}' --attach source=fixtures/ambiguous --out take-ambiguous --timeout 2m
```

The Agent is asked to abstain. If it selects a column anyway, show that actual
mapping and explain why a structurally valid preview still needs review. If it
abstains, explain that this one outcome is not a guarantee. Keep this brief;
do not turn the video into a prompt-tuning session.

### 12:00–14:00 — Name what made this possible

Suggested close:

> We started with one mapping method. We gave it an Agent implementation, then
> combined direct code and Agent interpretation behind the same boundary.
> Code and Agent work belong in the same program.

Explain the two products through the demonstrated responsibilities:

- FLOW provides the common package and invocation boundary for these methods.
- The application owns mapping, row checks, and whether to accept the preview.
- Jig runs the reviewed methods with operator-supplied powers and accounts for
  execution, cancellation, and cleanup. It is not directing the mapping logic.

If using the Skill analogy, name it: “If you use SKILL.md to give an Agent guidance,
FLOW adds a way to package executable methods that software can call and compose.”
Clarify that Skills can include scripts, and this executable calling boundary
is the point of the comparison. Do not use “You've taught an Agent” as shorthand
for installing a Skill or imply a Markdown rename alone creates this application.

End on the public example and its README. Invite the viewer to adapt the fields
for one real import task. Keep database integration and other file formats for
separate examples with their own teaching purpose.

## Visual treatment and scope

Use a readable editor and terminal, with source and output side by side. A small
conceptual diagram can show `import → mapper → converter → preview`. Reveal
code, Agent, and mixed implementations inside the mapper box; indicate that the
mixed implementation conditionally calls an Agent capability. This diagram illustrates
authored call order, not a live graph UI or an autonomous router supplied by Jig.

No frontend, upload widget, dashboard, database, Excel, OCR, live progress channel,
or generated-code execution is part of this example. Show a CSV becoming a useful
JSON preview; do not represent a mock interface as a shipped Jig feature.

## Completion check

The video succeeds if a viewer can explain the unchanged caller, the shared mapping
contract, the Agent's limited job, the code-owned checks, and why a preview still
needs review. Keep recordings and run evidence under `.tmp/`; this guide remains
a reusable production plan rather than a report of one rehearsal.
