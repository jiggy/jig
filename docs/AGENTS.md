# Documentation

## Purpose

Owns public normative specifications, current product guidance, and research
catalogues for FLOW and Jig.

## Ownership

- `flow/` owns portable FLOW meaning and explanatory FLOW guidance.
- `jig/` owns Jig host contracts, current guidance, and product research.
- `site/` renders and publishes this content. It does not own its meaning.
- `AGENTS.md` is repository-operational metadata and is not public site
  content.

## Local Contracts

- Classify a document as specification, current guide, or research.
  Do not mix those levels of authority.
- Specifications define requirements. Guides explain implemented behavior,
  distinguish source candidates from published support, and defer to
  specifications. Research records hypotheses and evidence gates,
  never availability or roadmap commitments.
- Link to the canonical owner instead of duplicating rules across documents.
- Check `LICENSES.md` before moving content between documentation classes.
  Their licenses differ.
- A project-controlled public HTTP(S) URI that names a Jig or FLOW concept must
  serve a human-friendly explanatory page.
  This rule excludes URIs that specify a machine-fetched resource.
  Explain the identifier's meaning. Explain why the reader might encounter it.
  Link to the canonical specification, usage guidance, and any downloadable machine artifact.
  An unrelated homepage is not enough.
- Software comparing an identity URI is not the same as fetching that URI.
  These pages do not participate in matching or grant authority.
  Never add runtime fetching to make an identifier browsable. URLs designated for schemas,
  descriptors, or other machine resources keep their exact format and bytes,
  with human guidance at a separate address. This is our publication rule, not
  a new requirement on independent FLOW implementers or third-party identifiers.

## Work Guidance

- Apply the [technical English rules](../.agents/maintainer-guide.md#write-clear-technical-english)
  to technical documentation and Agent instructions.
- Preserve exact public requirements, identifiers, examples, and uncertainty
  when changing prose.

- Read the [communication guide](../.agents/communication.md) and its audience
  reference before writing public entrypoints. Each section should answer a
  question raised by the preceding section.
  Use connected examples to explain capability compounding and programmable execution before architectural detail.
  Keep ambition distinct from demonstrated support. Preserve safeguards.
- Address the developer directly on landing pages.
  Name Skills when using that familiar bridge. Lead with callable composition.
  Keep enterprise operating concerns in relevant guides.
  Explain execution boundaries after explaining their useful role.
- Organize navigation around starting, building, understanding, and reference.
  Tutorials should include an expected result and one useful modification.
- Write for the reader's decision or task. Introduce unfamiliar concepts in
  plain language before criteria, fields, or implementation detail.
- Keep human and agent paths equally useful. Every public page must retain
  its meaning in generated Markdown, including inactive interactive examples.
  Agent guidance routes to exact contracts and respects existing authorization.
- Keep current support visibly separate from future research.
- Keep diagrams focused on one reader question.
  Use short labels and meaningful alternative text.
  Preserve the important limits in adjacent prose.
  Prefer static SVGs in guides. Use the site's existing image zoom instead of
  embedding a separate viewer or adding diagram controls to the reading path.
- Keep each Archify `*.diagram.json` beside its exported SVG and owning guide.
  Edit the JSON. Check the diagram with the repository Archify skill.
  Deliver the diagram with that skill. Export SVG through the delivered viewer.
  Preserve the Archify MIT notice in an SVG comment. Keep HTML previews, screenshots,
  and validation receipts in `.tmp/`. Never hand-edit generated SVG geometry.
  Diagrams explain their owning prose and do not establish new contracts.

## Verification

- Build each affected public site into a fresh directory with
  `scripts/build-site.sh`.
- When adding or changing a project-owned identity URL, include its explanatory
  route and links in site verification.
  Check deployed availability separately from local build success.
- For diagram changes, follow Archify's artifact and browser checks.
  Inspect both themes. Check the actual guide at desktop and mobile widths. Keep
  automated browser evidence separate from perceptual visual review.

## Child DOX Index

- [flow/AGENTS.md](flow/AGENTS.md) — Portable FLOW specifications and public
  guidance.
- [jig/AGENTS.md](jig/AGENTS.md) — Jig specifications, product guidance, use
  cases, and orchestration research.
