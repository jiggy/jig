"""Qualify wheel and sdist against the exact SDK wheel, without checkout imports."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory


def main():
    artifacts = [Path(argument).resolve() for argument in sys.argv[1:]]
    if len(artifacts) != 3:
        raise SystemExit("usage: package_smoke.py PROFILE.whl PROFILE.tar.gz SDK.whl")
    with TemporaryDirectory(prefix="user-updates-package-") as temporary:
        directory = Path(temporary)
        consumer = directory / "consumer"
        shutil.copytree(Path(__file__).parent, consumer)
        environment = dict(os.environ, USER_UPDATES_INSTALLED="1", PYTHONDONTWRITEBYTECODE="1", PIP_CACHE_DIR=str(directory / "pip-cache"))
        environment.pop("PYTHONPATH", None)
        environment.pop("PYTHONHOME", None)
        for index, artifact in enumerate(artifacts[:2]):
            venv = directory / f"venv-{index}"
            subprocess.run([sys.executable, "-m", "venv", venv], check=True, timeout=120)
            python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            subprocess.run([python, "-m", "pip", "install", "--no-deps", artifacts[2], artifact], check=True, env=environment, timeout=120)
            subprocess.run([python, "-I", "-c", """
from importlib.metadata import metadata
from importlib.resources import files
import jiggy
from jiggy.user_updates import USER_UPDATES_CONTRACT
assert jiggy.__spec__.origin is None
assert files('jiggy.user_updates').joinpath('py.typed').is_file()
assert files('jiggy.user_updates').joinpath('user-updates.json').read_bytes() == open(__import__('sys').argv[1], 'rb').read()
assert metadata('jiggy-user-updates')['License-Expression'] == 'MPL-2.0'
assert metadata('jiggy-user-updates')['Requires-Dist'] == 'jiggy-flow==0.1.0a7'
assert USER_UPDATES_CONTRACT['id'] == 'https://jig.md/contracts/user-updates'
""", str(Path(__file__).resolve().parents[1] / "src/jiggy/user_updates/user-updates.json")], check=True, env=environment, cwd=consumer, timeout=30)
            subprocess.run([python, "-I", "-m", "unittest", "discover", "-s", consumer, "-p", "test_*.py", "-v"], check=True, cwd=consumer, env=environment, timeout=120)
            subprocess.run([sys.executable, "-m", "mypy", "--strict", "--follow-imports=silent", "--python-executable", python, consumer / "typing_consumer.py"], check=True, cwd=consumer, env=environment, timeout=120)


if __name__ == "__main__":
    main()
