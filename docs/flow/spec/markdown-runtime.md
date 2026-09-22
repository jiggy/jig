# FLOW Markdown/1

> *Status: prerelease specification candidate for sequential Markdown execution.*

Markdown/1 projects finite SDK operations through exact recipes inside an ordinary
`FLOW.md` procedure. Every body uses bounded Agent interpretation, including a
body made entirely of recipes. Recipes are available actions, not an automatic
execution sequence. Every call still crosses Run/1 and every result is a complete
`{outcome, output}` value. The profile adds no scheduler,
provider framework, tool authority or expression language.

[Package/1](package-format.md) owns the single entrypoint and its optional
frontmatter. [Invocation Contract/1](invocation-contracts.md) exclusively owns
input/result validation, explicit outcomes and ports. A code implementation
instead uses optional `FLOW.meta.json`; simultaneous implementations and a
sidecar beside `FLOW.md` reject. Source resources remain ordinary captured files.

A host must qualify the exact parser, interpreter, profile, reasoning dependency
and actual grants before execution. Missing support fails visibly; a valid
Markdown package does not itself establish executable support.

## Source, resources and Skill restrictions

Retain Package/1 UTF-8/path rules and bounded YAML 1.2 JSON-schema parsing. Optional
frontmatter starts only with an exact first-line delimiter. Reject duplicate keys,
tags, anchors, aliases, merges, non-string keys and values outside JSON/1.
Frontmatter/sidecars retain the 256 KiB, depth-16, 4,096-node and 256-entry/item
bounds. Frontmatter opens with a first line exactly `---` and closes at the next
line exactly `---`; line endings are not part of the delimiter. A started
frontmatter block without a closing delimiter rejects metadata. Empty frontmatter
is the empty metadata object; a non-object YAML document rejects.

Use [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)
for document structure, with the exact recipe rules below. Each runtime records
its concrete parser artifact/version and interpreter artifact in its host's
qualification evidence; a particular language's parser library is not mandated
by FLOW. Parser conformance, source offsets and bounded construction must be
verified before qualification.

Preserve scripts, assets and references as captured resources. The interpreter
can read bounded admitted package-local UTF-8 regular files by exact manifest
path. No working-directory traversal, URL fetch, script execution or binary
interpretation is implied. A resource cannot register recipes, slots or tools.

The [Agent Skills specification](https://agentskills.io/specification) describes
name/description, resource conventions and experimental `allowed-tools`.
Renaming preserves many source documents; it does not prove task completion,
environment support or equivalent tools.

Interpret `allowed-tools` explicitly:

| Value | Available actions |
| --- | --- |
| Absent | Eligible authored recipes and captured-resource reads. |
| Empty after trimming ASCII spaces | No resource reads or call/send/receive effects. |
| Exactly `Read` after that trimming | Captured-resource reads; no call/send/receive effects. |
| Any other nonempty value, including Bash patterns | Whole-invocation qualification fails before reasoning/effects. |

This table defines the Markdown profile's enforcement. Accepting `allowed-tools`
syntactically in a code sidecar does not implement that enforcement: a code
runtime must explicitly qualify enforcement of the declared restriction, or mark
the package execution-unsupported. This profile does not qualify any code
runtime's tool-restriction support. The field cannot silently become inert.

The Read projection is narrower than arbitrary harness filesystem Read. It never
qualifies a dependency by its name or apparent read-only behavior. Internal
reasoning, explicit return/finish and endpoint close/disposal remain available;
tool restrictions cannot prohibit required settlement. Unavailable effect recipes
follow the availability rules below. No restriction grants authority.

Display compatibility/environment prose during review. Known missing required
facilities prevent qualification; a missing prerequisite discovered during work
fails before its requested effect. Parsing cannot certify arbitrary requirements
or prove a model's completion claim. Shell scripts need separately supported
execution authority; this profile supplies none.

## Frozen recipes; Agent-directed interpretation

Candidate recipes are fenced-code-block nodes directly under the document root.
Compare the RAW opening-line text after the opening fence, trimming only U+0020
space and U+0009 tab at its ends, with exact lowercase `flow`. Do not unescape,
decode entities, normalize Unicode or select only the first word. Consequently
`fl&#111;w`, `FLOW`, `flow example` and non-ASCII padding are inert.

Exposed recipes require a matching explicit closing fence according to CommonMark
0.31.2; an unclosed candidate remains a candidate with an unavailable diagnostic,
not an executable block. Source offsets determine full fence spans, including
their indentation, rather than searching rendered HTML. Quoted or list-nested
blocks, indented code, HTML contents, and inner fences displayed inside a larger
example fence are inert. Prose saying “example” does not change a candidate's
status. Only original entrypoint spans participate.

Inspect every candidate before reasoning/effects. Freeze its span, instruction
or exact diagnostic, and availability. A malformed recipe, unknown recipe
target, unsupported recipe operation or absent optional endpoint
is exposed as unavailable. Its selection returns a bounded pre-effect diagnostic;
unrelated prose may continue. There is no model repair or deferred source parsing.
Unsafe/invalid package metadata, missing required dependencies or invocation ports,
unsupported tool restrictions and missing reasoning remain whole-run failures:
this does not turn Invocation Contract/1's required declarations into optional dependencies.

Frozen unavailable meaning remains exact and grants no effect. This preserves
otherwise supported instructions around an unused malformed FLOW tutorial.
The same rule applies to recipe-only bodies. Known runtime uncertainty/failure
is never reclassified as mere recipe unavailability.

Each executable fence contains exactly one SDK instruction:

```text
call <slot> <operand>       run.call; complete RunResult
send <channel> <operand>   sender.send
receive <channel>          receiver.next
close <channel>            endpoint.close
return <operand>           complete RunResult; stop
```

The right-hand explanations are not syntax. Parse the CommonMark literal block
content, trimming only space/tab/CR/LF at its ends. Operation/name tokens are
separated by one or more spaces or tabs. For operand-bearing operations, the
entire remaining text is either one exact operand token or one complete JSON/1
value; JSON whitespace may span lines. A second instruction, trailing comment,
extra token or malformed JSON rejects that recipe. There is no shell tokenization.

Names are literal LocalNames; declared directions, actual grants and value
schemas remain checked. No generic slot tool exists; the Agent can activate
only an available frozen recipe.

## Exact data without an expression language

| Operand | Activation meaning |
| --- | --- |
| JSON/1 | Frozen literal; all nested content remains literal. |
| `@input` | Immutable invocation input. |
| `@previous` | Latest successful call or non-EOF receive's complete SDK result. |
| `@value` | Agent must choose an existing immutable whole-value handle. |
| `?` | Agent must supply fresh literal JSON. |

For receive, `@previous` is the iterator result, not the message alone.
The Agent can select the exact message handle through `@value`.
Receive followed by `send published @previous` forwards the iterator wrapper,
not an implicit conversion to its message.

`@value` earns its separate spelling: “forward an existing exact review” can
forbid model reconstruction, while `?` deliberately permits authored data. A
combined operand cannot enforce that distinction. This constrains operand origin,
not which earlier review the Agent prefers or the review's domain truth.

The invocation-local value table retains input, complete call result plus exact
output, and non-EOF iterator result plus exact message. These are fixed SDK
projections, not arbitrary field selectors. Null messages have ordinary handles.
An EOF iterator result can be retained, but clears `@previous`. For an attempted
call/receive, first resolve and snapshot operands against the pre-activation
cursor, then clear that cursor, then dispatch only if validation succeeded.
Resolution/validation failure still leaves the cursor absent. Thus
`call archive @previous` captures the earlier result before invalidating it.
Successful completion sets the new cursor; send/close never update it.
Older values remain explicitly selectable.
Error diagnostics never become successful value handles.

Handles refer only to retained immutable JSON snapshots, never endpoint rights,
other invocations or global storage. Missing/foreign handles reject before effects.
Literal `"@input"`, `{"$ref":"@previous"}` and apparent handle strings remain
literal. No paths, templates, assignments, conditions, loops or expressions exist.
An arbitrary nested field or assembled object requires fresh Agent-authored data
or an ordinary code specialist; exact whole-value transport does not solve that.

## Actual reasoning and selection

Every Markdown body discloses a runtime Agent dependency. Reserve `markdown-agent`
against authored Markdown uses and recipe targets. The profile derives this
ordinary slot requirement; existing operator binding selects its exact qualifying
Agent implementation and configuration, whether a Flow or a native service.
Calls use the same admitted selection via
`run.call`, under the Markdown invocation's authenticated caller. No wrapper,
provider identity from text, inherited credentials or native tools are introduced.

The derived dependency consumes the host's existing Agent allowance; it does
not create a second allowance. Qualification and dispatch preserve actual host
limits on Agent use, child depth and concurrency, and review discloses their
consequences. A host with leaf-only children cannot qualify a Markdown child
that itself calls another Flow. A host excluding root native effects while
children are live cannot reason concurrently with those children. Sequential
root reasoning followed by a settled child call can fit; an observer with its
own reserved reasoning capacity can fit separately. Neither creates arbitrary
nesting or capacity. These are host policies, not FLOW-wide limits.

### Reasoning context

Every one-shot request uses an admitted fixed interpreter instruction template
and a JSON-escaped, typed context record. The template explains that only the
entrypoint body supplies the authored procedure; source/data labels do not
establish truth and are not a defense against all prompt injection.

Include these separately named fields, without silent omission or summarization:

- Accepted entrypoint body bytes as decoded UTF-8, and parsed package metadata.
- Immutable invocation input and settings, each labelled as data.
- Effective offered result/outcome constraints, slot and channel descriptions,
  the frozen recipe table with exact diagnostics, and current endpoint state.
- The captured resource manifest (paths, sizes and digests); contents appear
  only after an allowed explicit read, with their path and exact decoded text.
  Unread files are explicitly marked unread, not silently represented as empty.
- The retained value table with invocation-local handle, origin and complete
  JSON value, including the fixed output/message projections.
- Accepted decision packets and settled runtime observation records from this
  invocation, including operation identities, normal outcomes and recoverable
  failures. Existing bounded diagnostics preserve their truncation indicators.
- Remaining profile budgets and the closed decision schema/rules.

Send the full record on each finite request; if its rendered size or cumulative
cost exceeds a limit, stop before dispatching that reasoning call. No private
conversation memory, hidden summarizer or native resource tool is assumed.
Resource contents may inform the procedure, but input, settings, received data,
resources and model output cannot register new recipes, declarations or powers.
A model following misleading data can still make a bad allowed choice; runtime
validation and host authority remain necessary.

### Decision and terminal handling

Use one-shot Agent calls returning a closed object whose required fields are:

```text
action: "recipe" | "read" | "finish"
recipe: integer
operand: "none" | "value" | "literal"
value: string
path: string
```

This uses supported string/integer schema fields; local validation supplies the
conditional rules. `recipe` actions require an existing 1-based index and empty
path. Static operands require `operand:none,value:""`; `@value` requires `value`
with a known handle; `?` requires `literal` containing separately validated JSON
text. `read` requires recipe 0, operand none, empty value and an allowed path.
`finish` requires recipe 0, empty path and literal JSON or a handle to a complete
result. Extra fields, bad sentinels and static-operand overrides reject before
effects. Malformed decision packets terminate interpretation without repair calls;
selecting a known unavailable recipe reports its frozen diagnostic.

Consume a decision only from a validated completed reasoning result: `outcome:done` with the requested structured value. A reasoner's `blocked` or
`limit` stops interpretation with an operational execution failure, retaining
the actual settled Agent result in bounded failure details. There is no retry,
invented root domain outcome or fallback to its prose as a decision. This is the
Markdown interpreter's explicit dependency-failure rule, not a protocol-wide
conversion: an authored recipe call's `blocked` or `limit` still arrives as
ordinary result data. Root cancellation/deadline and uncertain execution retain
their existing operational failure semantics.

The interpreter catches recoverable SDK errors and includes bounded runtime facts
in the next decision context, independently of model narrative. Each reasoning
call settles before recipe dispatch, releasing its worker capacity. The isolated
interpreter and native provider retain their separate authority/credential scopes.
All work shares existing root reservations, deadline and cancellation.

Fresh accepted activation ordinals produce caller-scoped operation IDs; reasoning
calls have separate IDs. Deliberately selecting again is new bounded work. Exact
transport duplication joins the same activation and snapshotted operands. Model
output cannot supply IDs. Possibly dispatched calls, including lost reasoning
responses, are never automatically replayed.

## Lifecycle, profile and bounds

The named first profile is sequential: one pending recipe operation, incoming
granted endpoints only, no creation, subscription, transfer or concurrent calls.
It cannot filter its own Agent's live updates or satisfy a call awaiting a later
recipe's send. Code implementations remain necessary for those methods. Future
profiles may project existing owned promises and channel operations, but require
concrete semantics/proof and add no host scheduler. A host's qualified incoming grants determine whether a particular invocation
can receive; the profile creates no additional root-input support.

Direct sends can backpressure; isolated broadcast readers can fail `LAGGED`.
Optional unwired endpoints are absent, while idle receivers wait within the root
deadline. Message delivery/EOF never establishes producer success. A conclusively
settled read or close error can be caught, including a late `LAGGED` first exposed
during disposal. Failed cleanup, unfinished ownership, root cancellation, fatal
transport and uncertainty still prohibit success. No acknowledgement ledger.

A body consisting only of spaces/tabs/CR/LF rejects execution as empty. Every
other body uses reasoning, including recipe-only, heading-only and comment-only
bodies. Adding prose or comments does not select a different execution mode.
The Agent chooses whether and when to activate recipes; there is no required
return recipe or implicit top-to-bottom execution. A selected valid return or
finish supplies a complete result and stops interpretation after settlement.
Use a code implementation when the method requires deterministic sequencing
or execution without an Agent.

Before returning, dispose held receivers and expose settled late failures to
reasoning. On failure, still dispose receivers without resuming interpretation.
Only an explicitly selected `close` recipe seals a writer in the interpreter.
Implicit writer sealing belongs to Run/1 finalization after full result validation
and owned-work settlement; failure aborts unsealed writers. An explicitly sealed
interval remains completed even if its producer subsequently fails. Neither
kind of channel completion establishes execution success.

Profile ceilings: 256 KiB entrypoint body; 4,096 AST nodes/depth 64; 256 recipes;
256 total recipe activations and 32 reasoning calls; 1 MiB aggregate loaded
resource text; 8 MiB retained JSON values; 1 MiB per rendered reasoning request
and 8 MiB cumulative rendered requests/responses. Count each exposed value's
encoded bytes even when storage shares snapshots. Existing tighter JSON, Agent,
channel, wire, token and aggregate host limits still apply. Charge prospective
parsing, reads, activations and reasoning requests before undertaking them.
A completed effect can return more data than the remaining value/context budget;
report that settled effect and visible exhaustion, stop interpretation, and
never replay it or claim a complete retained value. Preflight cannot predict all
future result sizes. No truncation or eviction changes instructions/operands.
These are
interpreter support ceilings, not universal package validity or new capacity.

Review/admission retains package/resources, parser and interpreter artifacts,
profile/bounds, compiled records/diagnostics, runtime dependency and selected
configuration/grants. Changes require review. None changes the offered interface
identity, creates local authority from a lock, or establishes provider portability.

## Illustrations

These illustrations describe the profile. They do not establish that a
particular host has qualified the required runtime, dependencies or grants.

### Renamed ordinary Skill: complete one-file package

`writing/FLOW.md`, formerly the identical `SKILL.md`:

```markdown
---
name: writing
description: Improve supplied prose while preserving its claims.
---
Return a concise revision. Preserve uncertainty and attribution.
```

No recipes, authored Agent slot or invocation contract are required. Its
qualified runtime reasons and returns a validated complete result; renaming
alone proves neither quality nor actual runtime support.

### Selection and exact forwarding: fragment

````markdown
---
uses:
  reviewer: {}
  archive: {}
---
Review when useful, then forward the chosen completed review unchanged.
```flow
call reviewer {"input":"data"}
```
```flow
call reviewer @input
```
```flow
call archive @previous
```
```flow
call archive @value
```
Create a new review request only through this recipe:
```flow
call reviewer ?
```
````

After review A succeeds and review B fails, `@previous` is absent. `@value` can
deliberately select A's complete result or exact output; it cannot accept retyped
JSON. `?` can author JSON but cannot turn a handle string into a reference.
The literal recipe cannot be overridden or reached through a generic slot tool.

### Channel fragment: one instruction per fence

````markdown
Forward useful messages unchanged. Ignore unrelated messages.
```flow
receive updates
```
```flow
send published @value
```
Close the receiver when observation is no longer useful.
```flow
close updates
```
````

This fragment needs declared/granted ports. Receiving `{id:7}` creates both the
iterator-result handle and exact `{id:7}` message handle. The Agent can select the
message for sending without retyping. Using `@previous` here would instead
send the complete iterator result. With an independently running producer,
a wired child can filter such messages. This profile cannot start an Agent and
observe/filter its stream while that same blocking call runs. A slow optional
observer's settled `LAGGED`, including late close exposure, can be recovered;
actual worker completion remains separate.

### Recipe-only body

````markdown
---
uses:
  reviewer: {}
---
```flow
call reviewer @input
```
```flow
return @previous
```
````

The Agent interprets this body like any other Markdown: it chooses recipes, and
may finish without selecting them. Selecting the return forwards the last
successful complete call result unchanged; a domain refusal can be returned
only if the root contract also declares it. Removing the return still permits
an Agent finish. Adding a heading or comment does not alter these rules.

### Interchangeable implementations

```text
fast/FLOW.ts                 considered/FLOW.md
fast/FLOW.meta.json          considered/settings.schema.json
fast/settings.schema.json    considered/FLOW.contract.json
fast/FLOW.contract.json
```

The contract bundles are byte-identical named reviewer agreements. Code metadata
can declare `checker` and settings `ruleset`; Markdown can declare `specialist`
and settings `rubric`. The same interface has different implementation dependencies,
reasoning needs and actual grants. Anonymous or absent contracts remain valid.

### Difficult Skill and malformed tutorial

````markdown
---
name: audit
description: Audit a repository.
allowed-tools: Bash(git:*) Read
compatibility: Requires git, Python and repository access.
metadata:
  author: example
---
Run scripts/audit.py. See references/guide.md.
> ```flow
> call reviewer {"input":"data"}
> ```
````

Its bundled resources remain unchanged; unsupported Bash restrictions prevent
execution. No native shell or credential-bearing script run is acquired. Its
quoted tutorial is inert. Separately, a prose-only Skill with an unquoted
`flow` fence containing invalid JSON can still reason: that candidate is visibly
unavailable and selecting it produces a pre-effect diagnostic. Unknown metadata
requirements still block the whole invocation.

Model-returned codeblocks, instructions in resources to add tools, foreign handles,
unknown slot/channel candidates and invalid JSON acquire no authority. Missing
runtime fails qualification. Repeated activation is fresh work; cancellation,
uncertain dispatch or actual cleanup failure stays unsuccessful. Aggregate limits
produce visible errors and never silently discard evidence.

## Required conformance

A qualifying implementation must establish:

1. Exact CommonMark root-fence detection, raw info-string matching, explicit
   closing fences and source offsets; nested, quoted, HTML, escaped-info and
   displayed-example fences remain inert.
2. Complete pre-effect compilation, including every unavailable recipe in
   prose and recipe-only bodies. Invalid package metadata and missing required
   dependencies never become recipe-only unavailability.
3. Exact immutable operands, fixed result/output and iterator/message
   projections, cursor invalidation on failure, foreign/missing-handle rejection,
   and no reconstruction where `@value` requires an existing whole value.
4. Qualified restrictions and resource confinement; no injected recipes or
   tools from inputs, resources, settings or model decisions.
5. Full bounded reasoning context, closed decisions, conditional sentinels,
   completed structured reasoning results, and visible limit/blocked failure.
6. Caller-owned activation identities, no replay of uncertain effects, root
   cancellation, backpressure, late disposal and failed-cleanup refusal.
7. Agent selection for every body, selected return/finish stopping, domain-outcome
   validation, charged parsing/value/context limits and honest post-effect exhaustion.
8. Receiver disposal on completion/failure, no implicit interpreter writer
   close, and preservation of explicitly sealed intervals on later failure.

The initial profile deliberately lacks concurrent own-call observation,
scripts/native tools, arbitrary field selectors and universal Skill compatibility.
Additional profiles require exact semantics
and separate qualification; no runtime may silently approximate those features.
