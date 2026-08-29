# Native preparation artifact boundary

**Status:** externally blocked on 2026-08-29 after one private implementation
attempt was rejected and removed. Review 175's native-installer design remains
selected; no preparation code or public interface was retained.

## 1. The attempted shortcut was not admissible evidence

The first implementation sketch let its caller supply an SDK archive path,
expected digest, retention assertion, and independently constructed dependency
manifest. That would have made a caller's claims stand in for all of:

```text
artifact provenance
retained lifetime
restart reacquisition
manifest-to-artifact identity
host installation policy
```

Checking that bytes at a caller-supplied path currently match a caller-supplied
digest proves only momentary integrity. It does not prove who admitted the
artifact, that the path will survive, that a replacement coordinator can
reacquire it, or that the dependency declared by the retained Package/1 is the
one being installed. The sketch was therefore deleted rather than hardened
into a private artifact store or package-manager integration.

## 2. Exact missing substrate

The first Bun preparation proof requires one administrator/operator-owned
record for the exact `@flowmd/sdk@0.0.0` archive. That record must:

- authenticate the retained archive artifact and its content identity;
- promise a lifetime which covers planning, admission, dispatch, restart
  reacquisition, fencing, and cleanup;
- be reacquirable from protected host state rather than a caller path;
- fail closed when absent, replaced, or expired; and
- give package code no registry, cache, package-manager, retention, receipt,
  or host-control authority.

The synthetic installer manifest and lock must be derived from the exact
retained source Package/1 native declaration and the authenticated artifact.
They are not independent caller inputs. Installer, toolchain, and runtime
facts likewise come from authenticated host observations.

An already-approved generic retained-artifact substrate with equivalent
evidence would also satisfy this boundary. None exists in the current host
contract.

## 3. Stop condition

Jig must not resolve this blocker by creating an SDK registry, blob-store
lifetime service, package-manager retention layer, Nix integration, or public
artifact-provider SPI. One missing proof artifact does not earn any of those
systems.

When the protected artifact record exists, implementation resumes at review
175 step 2: construct one distinct private prepared-tree identity, perform one
offline script-free install in its own contained durable owner, and preserve
the existing no-redispatch and complete-fence contract.

The current result is an exact external boundary, not an implementation
failure hidden as graceful degradation:

> Native first-party SDK preparation is unavailable until the host admits and
> retains the exact dependency artifact. Jig neither guesses an ambient
> archive nor manufactures the authority which would make one trustworthy.
