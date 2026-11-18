---
"@jigging/jig": patch
---

Show source behavior by default in `jig inspect --flow`. Capture a baseline with `--snapshot`, then use `--compare` for source-linked changes to configured uses, calls, results, and effects. The diff also surfaces newly captured call order when complete paths cannot be matched. Add `--all` to see complete changed paths. Use `--topology` for configured connections.

Use `jig inspect --flow --package PATH` to find a Flow package's configured uses, direct caller slots, and settings differences.
