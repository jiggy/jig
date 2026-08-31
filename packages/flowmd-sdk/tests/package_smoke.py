from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


def main() -> None:
    artifacts = [Path(argument).resolve() for argument in sys.argv[1:]]
    if len(artifacts) != 2:
        raise SystemExit("usage: package_smoke.py DIST.whl DIST.tar.gz")
    if not any(path.suffix == ".whl" for path in artifacts):
        raise SystemExit("a wheel is required")
    if not any(path.name.endswith(".tar.gz") for path in artifacts):
        raise SystemExit("an sdist is required")

    with TemporaryDirectory(prefix="flowmd-sdk-package-") as temporary:
        install_environment = {
            **os.environ,
            "PIP_CACHE_DIR": str(Path(temporary, "pip-cache")),
            "XDG_CACHE_HOME": str(Path(temporary, "cache")),
        }
        for index, artifact in enumerate(artifacts):
            if not artifact.is_file():
                raise SystemExit(f"artifact does not exist: {artifact}")
            environment = Path(temporary, f"venv-{index}")
            subprocess.run(
                [sys.executable, "-m", "venv", environment],
                check=True,
                env=install_environment,
                timeout=120,
            )
            python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            subprocess.run(
                [
                    python,
                    "-m",
                    "pip",
                    "--disable-pip-version-check",
                    "install",
                    "--no-deps",
                    artifact,
                ],
                check=True,
                env=install_environment,
                timeout=120,
            )
            subprocess.run(
                [
                    python,
                    "-I",
                    "-c",
                    """
from importlib.metadata import metadata
from importlib.resources import files
import flowmd_sdk
from flowmd_sdk import EffectError, OperationError

operation = OperationError("UNAVAILABLE")
effect = EffectError("not-found", None)
assert operation.code == "UNAVAILABLE"
assert effect.error_name == "not-found"
assert files("flowmd_sdk").joinpath("py.typed").is_file()
assert "../../docs/" not in metadata("flowmd-sdk").get_payload()
""",
                ],
                check=True,
                env=install_environment,
                timeout=30,
            )


if __name__ == "__main__":
    main()
