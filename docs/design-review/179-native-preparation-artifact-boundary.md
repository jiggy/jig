# Native preparation artifact boundary

**Status:** superseded in part on 2026-08-29 by
[review 186](186-package-local-native-artifact-correction.md). The rejected
caller-asserted API remains rejected. The conclusion that the SDK archive
needed administrator-owned admission was a category error; dependency bytes
now remain inside captured Package/1 and ordinary Plan/apply authority.

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

## 2. Superseded missing-substrate conclusion

This review originally required one administrator/operator-owned record for
the exact `@flowmd/sdk@0.0.0` archive. That would have required the host to
approve ordinary untrusted package dependencies and is no longer current.

The underlying requirements remain, but their owners are now precise:

- capture the archive inside the Package/1 content identity;
- retain Package/1 through planning, admission, dispatch, restart
  reacquisition, fencing, and cleanup;
- reacquire it from the protected PackageArtifact store rather than a caller
  path;
- fail closed when absent, replaced, or expired; and
- give package code no registry, cache, package-manager, retention, receipt,
  or host-control authority.

The synthetic installer manifest and lock must be derived from the exact
retained source Package/1 native declaration and its captured relative member.
They are not independent caller inputs. Installer, toolchain, and runtime
facts likewise come from authenticated host observations.

The existing protected PackageArtifact store supplies the required content
lifetime and restart reacquisition. Explicit Plan apply supplies admission
authority.
Neither turns dependency bytes into trusted host machinery.

## 3. Preserved stop condition

Jig must not resolve this blocker by creating an SDK registry, blob-store
lifetime service, package-manager retention layer, Nix integration, or public
artifact-provider SPI. One missing proof artifact does not earn any of those
systems.

Implementation resumes at review 175 with a package-local captured archive:
construct one distinct private prepared-tree identity, perform one offline
script-free install in its own contained durable owner, and preserve the
existing no-redispatch and complete-fence contract.

The corrected result is an exact local boundary, not an implementation failure
hidden as graceful degradation:

> Native first-party SDK preparation uses only dependency bytes already
> committed by captured Package/1 and explicit Plan apply. Jig neither guesses
> an ambient archive nor asks the host administrator to approve package code.
