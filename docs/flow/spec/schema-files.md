# FLOW Schema/1 files

> *Status: prerelease specification candidate. The machine meta-schema is
> published as [`schema-1.json`](https://flow.jig.md/schemas/schema-1.json).*

FLOW packages may expose three fixed, inert JSON Schema files. They describe
values; they are never runtime mailboxes, configuration stores, templates, or
code.

| File | Exact value validated |
|---|---|
| `input.schema.json` | `flow/run.params.input` |
| `settings.schema.json` | `flow/run.params.settings` |
| `result.schema.json` | The complete normal `{ "outcome", "output" }` result |

The third name is `result`, not `output`, because a package may declare several
outcomes whose legal output shapes differ. Validating the complete value lets a
schema express that correlation; an output-only schema could not.

## 1. Absence has exact semantics

- Run `settings` is always a JSON object, whether or not a schema exists.
  Arrays, scalars, and `null` are never settings values.
- Without `input.schema.json`, any value admitted by the bounded FLOW JSON
  data model is valid input.
- Without `settings.schema.json`, the only valid settings value is `{}`. A
  package must contain a settings schema to expose a configurable seam.
- Without `result.schema.json`, any result satisfying the Run/1 base envelope
  and declared-outcome rules is valid.

Absence never asks a host to infer a schema from TypeScript, Markdown,
environment variables, defaults, examples, or an earlier invocation.

## 2. Validation points

The host parses and validates every present schema while creating the inert
package snapshot, before package code or instructions can run.

Settings are first required to be one complete JSON object and are then
validated against `settings.schema.json` before runtime selection or
execution. There is
no inheritance, merge, per-Run overlay, environment fallback, or default
insertion.

A value chosen once for a configured use, such as `maxRetries`, is a setting.
A value expected to vary from one invocation to another is Run input. Durable
working data belongs in an attachment or bound capability. These three seams
replace variable interpolation rather than hiding it elsewhere.

Input is validated against the actual call value before a Run process starts.

A normal component result first passes the Run/1 envelope checks: it has one
declared domain outcome and an `output` value, and it is not a protocol,
execution, cancellation, provider-loss, or uncertainty failure disguised as a
domain outcome. After all owner work has quiesced, the host validates the
complete result against `result.schema.json`; only then may owner success commit.
Validation failure is `INVALID_RESULT`.

## 3. Schema/1 dialect

Each file is a JSON object whose root contains this exact declaration:

```json
"$schema": "https://flow.jig.md/schemas/schema-1.json"
```

Schema/1 is a closed, resource-bounded dialect of JSON Schema 2020-12. Boolean
schemas are allowed below the root. A keyword is valid only in the locations
and with the value shapes assigned to it by JSON Schema 2020-12.
Both schemas and instances first satisfy the
[`FLOW JSON/1 value model`](json-values.md).

The complete v1 keyword allowlist is:

```text
$schema  $defs  $ref  $comment  title  description  examples
type  enum  const
allOf  anyOf  oneOf  not  if  then  else
properties  required  additionalProperties  minProperties  maxProperties
dependentRequired  dependentSchemas
prefixItems  items  contains  minContains  maxContains
minItems  maxItems
minLength  maxLength
minimum  exclusiveMinimum  maximum  exclusiveMaximum
```

Every other keyword is a schema error at every depth. In particular, v1
rejects:

```text
$id  $anchor  $dynamicAnchor  $dynamicRef  $vocabulary
default  format
pattern  patternProperties
contentEncoding  contentMediaType  contentSchema
unevaluatedItems  unevaluatedProperties
multipleOf
uniqueItems
propertyNames
```

`format` is rejected rather than treated differently by different validator
defaults. `pattern` is deferred to avoid regex-engine and resource-consumption
differences. `multipleOf` is deferred to avoid cross-language numeric
disagreement. `uniqueItems` is deferred because portable deep-uniqueness work
is difficult to bound. `propertyNames` is deferred to avoid inventing a virtual
instance-pointer identity for object keys. Values in `const` and `enum` are
limited to JSON/1 scalars; structural alternatives use schema applicators.
`description` and `examples` remain inert annotations. A Capability Contract
descriptor which embeds them still digests the complete descriptor; “inert for
validation” does not mean “excluded from interface identity.”

`$defs` is allowed only on the root object. Definition names match
`[A-Za-z][A-Za-z0-9]{0,63}`. `$ref` accepts only an acyclic same-document
reference spelled exactly `#/$defs/<name>` with one such definition name;
percent encoding and JSON Pointer `~` escapes are not supported. Remote,
relative, anchor, recursive, and dynamic resolution are invalid. Referenced
definitions use the same closed dialect.

For a Capability Contract/1 embedded schema graph, the descriptor's `$defs`
map is the sole root definition map. Method, error, and definition schemas do
not declare their own `$defs`. All embedded roots and shared definitions are
compiled together so the graph-wide node, depth, and reference rules cannot be
evaded by splitting an interface into many methods.

Validation is pure. A conforming evaluator never coerces a value, inserts a
default, removes a property, resolves a URI, executes code, or changes the
instance. Number handling and equality use JSON/1 rather than host-language
integer or decimal extensions.

The exact same Schema/1 keyword and evaluation dialect is used by embedded
input, output, and error-data schemas in Capability Contract/1; embedded schemas
do not repeat the file-root `$schema` declaration. FLOW does not maintain two
subtly different schema languages.

## 4. Required limits

A conforming host rejects before evaluation when any one schema exceeds:

```text
encoded schema file       256 KiB
schema nesting depth      64
schema nodes              4,096
```

A **schema node** is the root or an object/boolean in a schema-valued position:
each `$defs` or `properties` value; each `allOf`/`anyOf`/`oneOf` or
`prefixItems` item; each `not`/`if`/`then`/`else`, `additionalProperties`,
`dependentSchemas`, `items`, or `contains` schema. Data under
`const`, `enum`, `examples`, and annotations is not a schema node. Schema depth
is the longest schema-child path with the root at depth 1. A `$ref` does not
duplicate its target for structural counting.

One validation has a deterministic budget of 1,000,000 **work units**. The
meter is an abstract function of the parsed schema and instance, never a count
of implementation actions. Each distinct
`(schema JSON Pointer, instance JSON Pointer)` pair evaluated costs 1 and is
memoized. Each present, semantically applicable keyword adds exactly:

| Keyword | Additional units and child evaluations |
|---|---|
| `$ref` | 1, then evaluate the target against the same instance. |
| `type` | 1 per allowed type name. |
| `const` | 1 scalar comparison. |
| `enum` | 1 scalar comparison per member, including members after a match. |
| `allOf`, `anyOf`, `oneOf` | 1 per listed branch and evaluate every branch. |
| `not` | 1 and evaluate its child. |
| `if` | 1 and evaluate the condition; if present, charge 1 and evaluate only the selected `then` or `else`. |
| `properties` | 1 per declared property; evaluate each declared property present in the instance. |
| `required` | 1 per listed name. |
| `additionalProperties` | 1 per instance member to classify; evaluate its schema for every member not declared by `properties`. |
| `minProperties`, `maxProperties` | 1 each. |
| `dependentRequired` | 1 per declared trigger plus 1 per required name for each trigger present in the instance. |
| `dependentSchemas` | 1 per declared trigger and evaluate each child whose trigger is present. |
| `prefixItems` | 1 per listed prefix schema and evaluate each position which exists. |
| `items` | 1 and evaluate every array item after the `prefixItems` range. |
| `contains` | 1 per array item and evaluate its child against every item. |
| `minContains`, `maxContains`, `minItems`, `maxItems` | 1 each. |
| `minLength`, `maxLength` | If either is present, charge the instance's Unicode-scalar length once, plus 1 per present bound. |
| `minimum`, `exclusiveMinimum`, `maximum`, `exclusiveMaximum` | 1 numeric comparison each. |
| annotations and `$defs` | 0 during instance evaluation. |

Object-key collections use RFC 8785 member order and arrays use index order.
All applicable branches and comparisons named above are charged even if an
implementation can logically short-circuit. An optimized validator may skip
physical work only if it computes the same abstract charge. Crossing the limit
is `SCHEMA_LIMIT_EXCEEDED`, never a false validation result.

Implementations may impose lower limits only in a separately named
nonconforming local mode. They must compute the normative meter before treating
an instance as merely invalid; exhaustion takes precedence. Once within the
budget, they may report only the first validation error. They must not quietly
skip an unsupported keyword or external reference.

## 5. Errors and inspection

Schema compilation errors use stable codes:

```text
SCHEMA_INVALID_JSON
SCHEMA_INVALID
SCHEMA_KEYWORD_UNSUPPORTED
SCHEMA_REFERENCE_INVALID
SCHEMA_LIMIT_EXCEEDED
```

`SCHEMA_INVALID_JSON` is reserved for invalid UTF-8, JSON syntax, duplicate
members, and other JSON/1 failures. `SCHEMA_INVALID` means the parsed value
violates Schema/1's root, keyword-location, or keyword-value-shape rules.
Keeping those cases distinct lets a host report malformed data without
misclassifying a well-formed but invalid schema as an unsupported extension.

Instance rejection uses `INVALID_INPUT`, `INVALID_SETTINGS`, or
`INVALID_RESULT`. Each diagnostic contains:

```text
code
instancePointer      RFC 6901; empty when no instance location applies
schemaPointer        RFC 6901
keyword              when applicable
```

Human wording and multi-error ordering are non-normative. Schema/1 defines no
standalone public schema digest. A package schema is identified by its
containing Package/1 digest and canonical logical path; an embedded schema by
its containing Capability Contract/1 digest and JSON Pointer. A host may use a
private cache fingerprint, but that value is not a portable identity,
compatibility token, lock input, or author-facing requirement. A host may
report those containing identities and locations, plus schema compilation and
example-fixture failures, without evaluating package code.

## 6. Examples

The companion examples are:

- [`input.schema.json`](https://github.com/jigmd/jig/blob/main/docs/flow/spec/examples/schema-files/input.schema.json)
- [`settings.schema.json`](https://github.com/jigmd/jig/blob/main/docs/flow/spec/examples/schema-files/settings.schema.json)
- [`result.schema.json`](https://github.com/jigmd/jig/blob/main/docs/flow/spec/examples/schema-files/result.schema.json)

They demonstrate shape validation and outcome/output correlation. They are
examples, not implicit schemas for packages which omit the files.
