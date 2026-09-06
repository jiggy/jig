# Documentation

## Purpose

Owns public normative specifications, current product guidance, and research
catalogues for FLOW and Jig.

## Ownership

- `flow/` owns portable FLOW meaning and explanatory FLOW guidance.
- `jig/` owns Jig host contracts, current guidance, and product research.
- `site/` renders and publishes this content; it does not own its meaning.
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
- Check `LICENSES.md` before moving content between documentation classes;
  their licenses differ.

## Work Guidance

- Write for the reader's decision or task. Introduce unfamiliar concepts in
  plain language before criteria, fields, or implementation detail.
- Keep current support visibly separate from future research.
- Keep diagrams focused on one reader question, with short labels, meaningful
  alternative text, and adjacent prose that preserves the important limits.
  Prefer static SVGs in guides; use the site's existing image zoom instead of
  embedding a separate viewer or adding diagram controls to the reading path.
- Keep each Archify `*.diagram.json` beside its exported SVG and owning guide.
  Edit the JSON, validate and deliver with the repository Archify skill, then
  export SVG through that delivered viewer and preserve the Archify MIT notice
  in an SVG comment. Keep HTML previews, screenshots,
  and validation receipts in `.tmp/`. Never hand-edit generated SVG geometry.
  Diagrams explain their owning prose and do not establish new contracts.

## Verification

- Build each affected public site into a fresh directory with
  `scripts/build-site.sh`.
- For diagram changes, follow Archify's artifact and browser checks, inspect
  both themes, and check the actual guide at desktop and mobile widths. Keep
  automated browser evidence separate from perceptual visual review.

## Child DOX Index

- [flow/AGENTS.md](flow/AGENTS.md) — Portable FLOW specifications and public
  guidance.
- [jig/AGENTS.md](jig/AGENTS.md) — Jig specifications, product guidance, use
  cases, and orchestration research.
