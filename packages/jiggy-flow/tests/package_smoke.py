from __future__ import annotations

import os
from pathlib import Path
import subprocess
import shutil
import tarfile
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

    with TemporaryDirectory(prefix="jiggy-flow-package-") as temporary:
        install_environment = {
            **os.environ,
            "PIP_CACHE_DIR": str(Path(temporary, "pip-cache")),
            "XDG_CACHE_HOME": str(Path(temporary, "cache")),
        }
        consumer = Path(temporary, "consumer")
        shutil.copytree(Path(__file__).parent, consumer)
        install_environment.pop("PYTHONPATH", None)
        install_environment.pop("PYTHONHOME", None)
        install_environment["FLOW_SDK_INSTALLED"] = "1"
        install_environment["PYTHONDONTWRITEBYTECODE"] = "1"
        for index, artifact in enumerate(artifacts):
            if not artifact.is_file():
                raise SystemExit(f"artifact does not exist: {artifact}")
            if artifact.name.endswith(".tar.gz"):
                with tarfile.open(artifact) as source_archive:
                    names = source_archive.getnames()
                    for required in ("pyproject.toml", "LICENSE", "README.md",
                                     "tests/fixture_component.py", "tests/typing_consumer.py",
                                     "tests/package_smoke.py", "src/jiggy/flow/py.typed"):
                        assert any(name.endswith("/" + required) for name in names), required
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
import jiggy
import jiggy.flow
from jiggy.flow import CapabilityError, OperationError

operation = OperationError("UNAVAILABLE")
effect = CapabilityError("not-found", None)
assert operation.code == "UNAVAILABLE"
assert effect.error_name == "not-found"
assert files("jiggy.flow").joinpath("py.typed").is_file()
distribution = metadata("jiggy-flow")
assert distribution["Version"] == "0.1.0a2"
assert distribution["License-Expression"] == "Apache-2.0"
assert not distribution.get_all("Requires-Dist")
assert "../../docs/" not in distribution.get_payload()
assert jiggy.__spec__.origin is None
assert not files("jiggy").joinpath("__init__.py").is_file()
assert callable(jiggy.flow.handle)
assert "run_child_flow" in jiggy.flow.RunContext.__dict__
assert "call_capability" in jiggy.flow.RunContext.__dict__
""",
                ],
                check=True,
                env=install_environment,
                timeout=30,
            )

            subprocess.run(
                [python, "-I", "-m", "unittest", "discover", "-s", str(consumer), "-p", "test_*.py", "-v"],
                check=True, cwd=consumer, env=install_environment, timeout=120,
            )
            subprocess.run(
                [sys.executable, "-m", "mypy", "--strict", "--follow-imports=silent",
                 "--python-executable", str(python), str(consumer / "typing_consumer.py")],
                check=True, cwd=consumer, env=install_environment, timeout=120,
            )


if __name__ == "__main__":
    main()
