# Skill references

Never edit generated files under `skills/*/reference/` directly.
Edit canonical sources selected by `skills/references.json`, then run `just sync-skills`.
Generated references contain selected documentation and required notices, without checksum manifests.
Freshness checks compare regenerated file contents directly.
Keep repository maintenance instructions in this file, outside generated reference content.
