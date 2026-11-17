# Experimental forced-policy control

These ignored files prepare a bounded diagnostic for a disposable GitHub-hosted
native ARM Mac. They have not been executed on macOS. Bare managed-preference
files are a hypothesis: the real frameworks decide whether they establish a
forced value. No successful fixture result proves MDM enrollment or delivery.

Run only after ordinary native helper, sandbox boundary, Codex startup and
cleanup checks. Do not run concurrent Codex or preference tests while this
control changes its own fresh policy file.

```sh
JIG_DISPOSABLE_MAC_POLICY_DIAGNOSTIC=1 python3 .tmp/forced-policy-positive/run.py "$PWD/packages/jig"
```

The package root must contain the real native helper and source with matching
entries in `support/macos-native-build.json`. The script refuses non-macOS,
non-ARM, root callers, non-GitHub environments and missing explicit opt-in.
Only the provisioning helper uses noninteractive sudo. The compiled independent
reader and shipped helper execute as the ordinary runner user.

The experiment tries the global and current-user managed-preference paths.
Before each write, both policy leaves must be absent, including symlinks. A
fresh unprivileged framework reader must also find both known Codex keys absent
and nonforced. No preexisting policy or ordinary key is overwritten or removed.
Each case writes one harmless unique string under one known key to a fresh
root-owned file. An independent real CFPreferences and NSUserDefaults reader
must agree that the selected value is forced and matches the fixture before
helper exit 71 counts as a positive observation. Framework calls, policy
results, helper flags, binaries and loaders are never replaced.

Cleanup requires the original device/inode, root ownership, single link and
exact retained bytes. It removes only its own file and any exact empty
fixture-created directories. A changed file is retained and the diagnostic
fails. Fresh ordinary reads and helper success are required after cleanup.
The diagnostic never kills a daemon, resets caches, removes profiles, changes
existing policy, starts a model request or creates a native client session.

The work allowance is 120 seconds, with at most 10 seconds for final exact
cleanup. Exit 0 means both known keys had real positive forced-status/refusal
observations. Exit 77 means recognition was incomplete; this is not a passing
qualification. Exit 1 means a precondition, command or exact cleanup failed.
All output is closed status and public key names; preference values and raw
framework/helper errors are not printed. Failed scratch evidence is retained.
Any unconfirmed cleanup prevents a positive result and requires discarding the
disposable guest through its ordinary provider lifecycle.

Relevant primary sources:

- Apple documents the real managed-status API:
  https://developer.apple.com/documentation/foundation/userdefaults/objectisforced(forkey:indomain:)
- Apple documents the managed preferences profile format:
  https://github.com/apple/device-management/blob/release/mdm/profiles/com.apple.ManagedClient.preferences.yaml
- Apple's client-management paper describes global and user managed-preference
  paths, but is historical evidence rather than a current bare-file API promise:
  https://www.apple.com/education/docs/Apple-ClientManagementWhitePaper.pdf
- Apple explains why complete command-line profile installation is unavailable
  starting with Big Sur:
  https://developer.apple.com/videos/play/wwdc2020/10639/
