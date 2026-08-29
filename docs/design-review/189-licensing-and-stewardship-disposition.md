# Licensing and stewardship release disposition

**Status:** selected as a non-operative release target on 2026-08-29 after
independent adversarial review of the proposed portfolio and the actual
repository boundaries. This record grants no licence, changes no package
metadata, and does not designate a legal owner. Licensing activates only as
one later reviewed release transaction after the gates in section 7 close.

## 1. Decision

Jig and FLOW do not ask one licence to serve incompatible roles. The selected
portfolio is:

| Subject | Intended terms |
|---|---|
| FLOW normative prose | Community Specification License 1.0 |
| FLOW normative machine schemas and registries | `Community-Spec-1.0 OR Apache-2.0`, with contributions accepted under both |
| FLOW SDKs, conformance code/data, reference implementations, generators, and non-normative examples | Apache-2.0 |
| FLOW explanatory prose | CC-BY-4.0; executable examples remain separately Apache-2.0 |
| Jig host, kernel, CLI, and implementation tooling | MPL-2.0, without Exhibit B |
| Physically separate Jig client SDKs, language bindings, and official Agent adapters | Apache-2.0 |
| Original skeletal Starter output copied into user projects | 0BSD |
| Substantive reusable Starter components | Apache-2.0 rather than 0BSD |
| Future Cloud and Enterprise products | Separate proprietary code and services |

Sley is an independent project. Its current material remains under its own
terms and governance; this repository must preserve its provenance and never
claim authority to relicense it.

This portfolio is deliberately asymmetric. FLOW implementation should be
easy and patent-aware. Jig asks only file-level reciprocity when covered files
are distributed. Applications, Flows, integrations, and separately written
commercial modules do not become MPL-covered merely because they use Jig.

## 2. Community-Spec is a process, not a file label

Community-Spec-1.0 is not intended for source code and cannot be activated by
dropping one licence text into the current mixed tree. Its patent terms depend
on an accompanying Scope, Notices, Governance, contribution process, Draft
and Approved Specification states, and implementer acceptance. It includes
reciprocal Necessary-Claims obligations and exclusion windows which deserve
specialist legal review.

Before the first Approved FLOW release, the normative specification moves to
one separate specification repository. That repository starts with the
smallest independently implementable release unit—expected to be Run/1 plus
the JSON, Package, and Schema modules it actually requires. Service and other
profiles remain separate Drafts until independently ready.

The repository must contain, at minimum:

```text
Scope.md
Notices.md
Governance.md
Contributing.md
the narrow Community Specification Contributor License Agreement
the Community Specification licence
versioned Draft and Approved deliverables
```

Each conformance role must state the required portions needed to implement
that role. Approved versions are immutable; corrections become explicit
errata or new versions rather than silent edits.

Normative machine schemas and error registries are simultaneously part of
the patent-bearing specification and useful software inputs. Dual
`Community-Spec-1.0 OR Apache-2.0` is therefore the target, with contributor
assent covering both. Validators, generators, conformance runners, SDKs, and
generated bindings remain Apache-only.

An Apache-licensed implementation which relies on Community-Spec's patent
grants must also perform the licence's implementer-acceptance step and identify
the implemented specification version. Including that notice does not change
the implementation code's Apache licence.

## 3. Governance and economic stewardship

FLOW uses the Community Specification consensus and appeal process. The
founder may be its initial Maintainer and editor, determine and document
consensus in good faith, publish official versions, and operate the official
project channels. That is not an unreviewable BDFL veto over the normative
working group. Jig remains separately founder/BDFL governed with a public RFC
threshold, documented release authority, conflicts policy, security exception,
and succession path.

The founder or a later real legal entity may own the official trademarks,
domains, repositories, package namespaces, signing keys, sponsor programme,
and optional verification service. The licence portfolio grants no trademark
rights. A future trademark policy must permit truthful nominative statements
such as “implements FLOW Run/1” and free self-conformance without permission
or fees, while reserving official logos and verification marks. A passing
suite is evidence, not “certification,” until a real certification programme
exists.

Sponsorship may fund maintenance, SDKs, conformance, documentation, audits,
and ecosystem work. Funding grants no special governance right. Sponsor
employees may participate on the same public terms as everyone else, but
sponsorship does not purchase a specification outcome, veto, private draft,
or mandatory implementation fee.

Commercial value remains outside artificial restrictions on local Jig:

```text
managed coordination and operations
team and enterprise governance
private catalogues and provenance services
optional verified conformance
support, training, and implementation services
commercial ecosystem distribution
```

Open Jig must remain capable of complete local use. Existing open features
must not later be moved behind a proprietary edition.

## 4. Contribution boundary

Code and non-normative documentation use DCO 1.1 sign-off, with no copyright
assignment and no broad commercial-relicensing CLA. Normative FLOW
contributions additionally use the narrow Community Specification Contributor
License Agreement because DCO alone does not clearly evidence assent to the
specification's reciprocal patent and governance obligations or employer
authority.

Contributors retain copyright. Consequently, community MPL modifications
cannot later be relicensed into a proprietary edition without the relevant
copyright holders. The business model accepts that constraint: proprietary
Cloud and Enterprise work stays in separate files or repositories and uses
the MPL core as a Larger Work.

## 5. Target repository map

The eventual implementation repository map is:

```text
packages/flow-sdk/**                         Apache-2.0
packages/flowmd-sdk/**                       Apache-2.0
conformance/**                               Apache-2.0
packages/jig/**                              MPL-2.0
future physically separate Jig clients/**   Apache-2.0
starters/**                                  0BSD or Apache-2.0 by substance
.agents/skills/sley/**                       upstream Sley terms and provenance
```

That map is not active yet. The current `docs/spec/**` mixes candidate FLOW
normative text, SDK guidance, public Jig client contracts, and private Jig host
policy. It must be curated before licensing:

- candidate FLOW prose and its normative machine artifacts move to the FLOW
  specification repository;
- SDK guidance moves with its Apache SDK package;
- Jig client contracts move with a physically separate Apache client package,
  if that separation is selected before publication;
- private Jig policy remains implementation documentation; and
- design reviews and explanatory guides are inventoried for embedded code and
  third-party quotations before a CC-BY map is applied. Executable snippets
  are marked Apache or moved to Apache examples.

Package READMEs follow their package's code licence rather than the general
CC-BY documentation rule, so each distributed archive has one intelligible
package boundary.

The simplest first Jig publication may instead license the current combined
`@jigging/jig` package wholly MPL and create Apache client packages later. A
single package must not advertise a compound SPDX expression as though it
described different per-file licences.

Generated output inherits the terms of its expressive source, templates, and
inputs. Apache-generated bindings require Apache or dual-licensed inputs and
templates, and must carry source/version provenance. Distribution bundles
must retain every applicable notice and MPL source offer.

## 6. Atomic activation

When the release gates close, licensing is applied as one deliberate slice:

1. curate and move the normative and client boundaries;
2. add the canonical licence texts and a human-readable path map;
3. add SPDX headers and REUSE mappings for JSON and generated files;
4. add contribution, governance, trademark, security, and third-party records;
5. set exact npm and Python package metadata;
6. include the relevant licence, NOTICE, and source-offer material in every
   packed artifact; and
7. test unpacked npm archives, wheels, sdists, bundles, and conformance
   distributions.

Adding a root `LICENSE`, package `license` field, SPDX map, trademark owner, or
Community-Spec acceptance notice before this transaction would be an operative
legal assertion over an unresolved mixed tree. It is explicitly deferred.

## 7. Release gates

The licensing transaction requires:

1. the actual licensor, copyright attribution, and trademark owner;
2. a Git/file provenance audit, including Sley material, copied snippets,
   generated files, and earlier imported or agent-authored material;
3. specialist legal review of Community-Spec Scope, reciprocal patent grant,
   required-role semantics, exclusions, withdrawal, and governance;
4. a curated FLOW specification repository with exact Draft/Approved units;
5. a decision on the current Jig core/client package boundary;
6. a documentation/snippet and generated-output licence inventory;
7. trademark clearance and a truthful compatibility/self-conformance policy;
8. working DCO and specification-participant assent enforcement; and
9. package/archive compliance tests.

Until those gates close, current private `0.0.0` packages and the repository
remain without a general public licence. This is intentional release hygiene,
not a plan to make the published projects source-available or proprietary.

## 8. Deliberate non-claims

This review does not:

- approve publication or remove any private package guard;
- assert ownership over every current file or over Sley;
- establish a FLOW Working Group, Scope, Approved Specification, trademark,
  certification programme, or legal entity;
- promise a future foundation transfer;
- choose an AGPL, BSL, FSL, custom non-compete, or source-available licence for
  Jig or FLOW; or
- substitute for jurisdiction-specific legal advice.

The durable principle is:

> FLOW is openly implementable through a real specification process; Jig is
> modestly reciprocal infrastructure; official stewardship and commercial
> services remain economically sustainable without selling protocol control.

## References

- [Community Specification 1.0](https://github.com/CommunitySpecification/Community_Specification)
- [Mozilla Public License 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [BSD Zero Clause License](https://spdx.org/licenses/0BSD.html)
- [Developer Certificate of Origin 1.1](https://developercertificate.org/)
