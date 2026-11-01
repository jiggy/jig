# Installable Jig skills

## Purpose

Help agents create and use understandable Jig projects with power under the operator's control.

## Ownership

- `jig/SKILL.md` owns the public Jig project workflow.
- `jig/agents/openai.yaml` owns optional skill-list presentation.
- `references.json` selects canonical documentation for the installed skill.
- [Jig documentation](../docs/jig/) owns reusable guidance and exact host contracts.
- [Project design](../docs/jig/guide/design.md) owns opinionated project practices.
- The [FLOW skill](https://github.com/jiggy/flow/tree/main/skills/flow) owns portable Flow design and authoring guidance.
- [Repository skills](../.agents/skills/) serve Jig maintenance.
- [Agent method](../packages/agent-method/AGENTS.md) owns Skills supplied as runtime Agent context.
- [Build tooling](../scripts/AGENTS.md) owns reference generation and freshness checks.
- [CI](../.github/AGENTS.md) owns reference synchronization automation.

## Local Contracts

- Keep one model-invoked `jig` skill for project creation, configuration, use, and review.
- Recommend the FLOW skill for new Jig projects and use it for portable method work.
- Add another skill only when its independent invocation justifies another always-loaded description.
- Keep shared rules, examples, and syntax in canonical documentation.
- Use package-local `reference/` links for bundled Jig guidance.
- Keep required resources inside the installable skill directory.
- Commit generated references, provenance, and required license texts with the skill.
- Generate references from this checkout without a FLOW checkout or a CI artifact download.
- Edit canonical sources to change generated content.
- Preserve source licenses, notices, exact examples, and machine-resource bytes.

## Work Guidance

- Use ordered steps with observable completion criteria.
- Give each reference pointer a concrete task condition.
- Keep component design in FLOW and host configuration in Jig.
- Label examples and state the assumptions behind their design choices.
- Respect existing authorization and distinguish review, execution, application outcomes, and delivery.
- Keep installation guidance separate from runtime Agent configuration.

## Verification

- Run `just sync-skills` after changing canonical sources or the reference map.
- Run `just check-skills` to detect missing or stale references.
- Run `bun scripts/check-docs.ts` for documentation links and technical prose.
- Check installation through the standard skills CLI in a separate consumer project.
- Exercise the installed skill without relying on the repository's documentation tree.

## Child DOX Index

- None.
