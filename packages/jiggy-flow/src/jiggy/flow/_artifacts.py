from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True, eq=False)
class _Artifact:
    reference: str


class _Artifacts:
    """Provenance only; the host is always the authority for grants."""

    def __init__(self) -> None:
        self._held: dict[str, _Artifact] = {}
        self._released: set[str] = set()

    def grant(self, reference: str) -> _Artifact:
        if reference not in self._held:
            self._held[reference] = _Artifact(reference)
        return self._held[reference]

    def reference(self, artifact: Any, *, allow_released: bool = False) -> str:
        if not isinstance(artifact, _Artifact) or self._held.get(artifact.reference) is not artifact:
            raise ValueError("artifact must be held by this Run")
        if not allow_released and artifact.reference in self._released:
            raise ValueError("artifact has been released")
        return artifact.reference

    def retire(self, reference: str) -> None:
        self._released.add(reference)
