# Private settings-only Binding child checkpoint

**Status:** accepted on 2026-08-29 after independent authority review and one
isolated cgroup-v2/Bubblewrap witness. This closes one configured Run-Binding
child profile for Bun. It does not add capability-bearing child Bindings or a
public routing surface.

## 1. The profile is intentionally smaller than a general Binding

One admitted Binding target may survive child resolution only when all of the
following are true:

```text
target                         Binding in Run mode, READY
Package/1                      exact retained digest and entrypoint
request attachments            empty
request slots                  empty
package metadata attachments   empty
package metadata uses          empty
settings                       exact retained value valid under Package/1
```

When `settings.schema.json` is absent, only `{}` is valid. Invalid or
undeclared retained settings indicate disagreement with the protected project
pipeline and close as corruption. They are not silently converted into a
candidate rejection.

Bindings outside this profile receive the deterministic private rejection
`TARGET_CONFIGURATION_UNSUPPORTED`. That name does not become Run/1 wire
vocabulary.

## 2. Resolver and store enforce different parts

The Resolver reopens exact Package/1, checks mode and entrypoint identity,
revalidates settings, and filters actual input for broad sources. An exact
source still reaches durable allocation before input validation.

The allocation store does not trust the Resolver's classification. It reopens
strict Candidate/5 and Lock/3 and independently requires:

- same-generation slot membership and active-parent exclusion;
- exact request, recipe, and observation identities;
- empty request attachments and slots; and
- empty locked-package attachments and capability uses.

Strict Lock/3 already binds those package declarations to their Binding
projection. Settings carry configuration rather than authority, remain inside
the immutable request and recipe identities, and are revalidated before the
controller allocates.

## 3. Execution required no new child framework

The existing child lifecycle already supplies `recipe.request.settings` to
RunHost, gives the child `{}` attachments, and installs no operation
dispatcher. Removing the Bun planner's artificial requirement that every
Binding have at least one slot therefore closes the missing zero-slot case
without adding a new scheduler or projection object.

Python configured-Binding execution remains unavailable and unclaimed. The
Resolver and allocation authority are runtime-neutral; a Python store fixture
proves only that separation, not a Python recipe.

## 4. Evidence

```text
Resolver                              10 tests, 32 assertions
durable allocation authority          1 test, 18 assertions
isolated contained composition        1 test, 56 assertions
contained duration                    491.1 seconds
TypeScript build and diff check        passed
residual Jig cgroups                   0
residual private device directories   0
host /dev/urandom                      character 1:9, mode 0666
```

The contained Bun child observes exactly `{ "profile": "child-only" }`, not
its parent's settings; receives the exact child input and no attachments; and
receives `UNAVAILABLE` when it attempts an undeclared effect. The initial
overlapping hostile attempt is excluded from evidence. Only the isolated run
counts.

## 5. Stop boundary

This checkpoint adds no:

- child attachments;
- capability or Flow-call slots on a configured child;
- child Journal, Service, or Agent effects;
- nested or recursive Flow composition;
- Semantic Choice;
- public `projectRunTargets()`; or
- public Resolver, Runtime Adapter, Backend, or provider SPI.

Capability-bearing workers require a real operator provider and a child-owned
durable effect path. Root-owned effect rows cannot be reused for them.
