---
name: focused-validation
description: Validate software-factory changes with the smallest relevant checks.
---

# Focused validation

Inspect the complete affected flow before editing. Prefer existing tests and
native project tools. Run the smallest check that can falsify the change, then
expand only when the result or risk justifies it. Never report success while a
relevant check is failing or owned work remains unfinished.
