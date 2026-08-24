# Scenario: one obvious use

The user creates a project containing only:

```text
default-run/
├── jig.ts
├── package.json
└── flows/
    └── greet/
        ├── FLOW.md
        ├── flow.ts
        ├── package.json
        ├── input.schema.json
        └── result.schema.json
```

`jig plan` discovers the inert package and derives proposed Binding `greet`
with settings `{}`, no slots, no attachments, no instruction configuration,
and only the portable sandbox baseline. The plan displays that derivation and
its authority delta. Nothing executes.

After the user applies that exact candidate, this starts one ordinary admitted
Run:

```text
jig run greet --input examples/greet.input.json
```

The CLI supplies its normal retry key. Root admission pins the derived Binding
revision and generation before validation and launch. The exact Bun Adapter
and enforcing Sandbox Backend remain host-selected activation evidence.

If the author later needs a reusable formal greeting, they add:

```text
bindings/formal-greet.ts
```

That is a second tailored use. A `bindings/greet.ts` declaration instead owns
that ID and suppresses the derived default completely, regardless of which
package it targets; it never merges with it. Removing that declaration only
proposes the default again in a later reviewed generation.
