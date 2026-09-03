# Documentation

## Purpose

Owns the normative specifications, current product guidance, research
catalogues, and recovery records for FLOW and Jig.

## Ownership

- `flow/` owns portable FLOW meaning and explanatory FLOW guidance.
- `jig/` owns Jig host contracts, current guidance, and product research.
- `suspended-experiments.md` is a recovery index for deleted work.
- `site/` renders and publishes this content; it does not own its meaning.

## Local Contracts

- Classify a document as specification, current guide, research, or recovery.
  Do not mix those levels of authority.
- Specifications define requirements. Guides explain shipped behavior and
  defer to specifications. Research records hypotheses and evidence gates,
  never availability or roadmap commitments.
- Link to the canonical owner instead of duplicating rules across documents.
- Git history preserves superseded designs. Recovery records do not make old
  designs current or compatible.
- Check `LICENSES.md` before moving content between documentation classes;
  their licenses differ.

## Work Guidance

- Write for the reader's decision or task. Introduce unfamiliar concepts in
  plain language before criteria, fields, or implementation detail.
- Keep current support visibly separate from future research.

## Verification

- Build each affected public site into a fresh directory with
  `scripts/build-site.sh`.

## Child DOX Index

- [flow/AGENTS.md](flow/AGENTS.md) — Portable FLOW specifications and public
  guidance.
- [jig/AGENTS.md](jig/AGENTS.md) — Jig specifications, product guidance, use
  cases, and orchestration research.
