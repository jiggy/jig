# Factory repair specialist

This Flow receives one captured issue, selected editable source paths, the
project's original text files, and fixed CLI acceptance cases. It reproduces a
baseline mismatch before asking an Agent for replacement text. The operator
binds its `tests` and `cli` slots to reviewed Bun commands; candidate code runs
only through those grants.

`settings: { maxProposals: 1 }` stops after one checked proposal.
`maxProposals: 2` allows one correction using observed check feedback. Both
settings require the same repository command and every independent acceptance
case to pass. The Flow returns proposal and command evidence for the factory to
inspect before writing a patch packet. It never edits the original project.

The method and its contracts live in this example, so the factory can be copied
and edited as one project. It depends only on the declared public FLOW and Agent
packages. The factory's issue and case files remain in `flows/factory/`.
